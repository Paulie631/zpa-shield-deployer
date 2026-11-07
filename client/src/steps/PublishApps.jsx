import React, { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { zpaAuth, zpaPortalBase, savedCustomerId, rememberCustomerId } from '../lib/zpa'
import { awsAuth } from '../lib/aws'

// Publish the test apps through ZPA:
//   1. a traffic-forwarding App Connector in the VPC (AWS), in its own connector group
//   2. app segments for DVWA and Juice Shop, served by that group
//   3. an access policy rule allowing them
// Every action reuses what already exists, so running it again is safe.
const TRAFFIC_STACK = 'zpa-traffic-connector'

export default function PublishApps({ data, update, next, back }) {
  const isAWS = data.target === 'aws'
  const ip = data.testAppsPrivateIp
  // OneAPI needs the numeric ZPA customer ID; this step can come before ZPA Setup, so ask here if unknown
  const [cid, setCid] = useState(data.customerId || savedCustomerId(data))
  const needsCid = data.authMode === 'oneapi' && !/^\d+$/.test(cid || '')
  const setCustomerId = (v) => { setCid(v); if (/^\d+$/.test(v)) { update({ customerId: v }); rememberCustomerId(data, v) } }
  const aws = awsAuth(data)

  // per-part state: { state: 'idle'|'running'|'done'|'error', lines: [], error }
  const [conn, setConn] = useState(data.publishConn || { state: 'idle', lines: [] })
  const [segs, setSegs] = useState(data.publishSegs || { state: 'idle', lines: [] })
  const [rule, setRule] = useState(data.publishRule || { state: 'idle', lines: [] })

  // Who the access rule applies to: everyone, or one SCIM group from the IdP
  const [scim, setScim] = useState(null)          // { groups, idps } or null while loading
  const [scimGroupId, setScimGroupId] = useState(data.accessScimGroupId || '')
  useEffect(() => {
    if (needsCid) return
    axios.get('/api/zpa/scim-groups', { params: zpaAuth({ ...data, customerId: cid }) })
      .then(r => setScim(r.data)).catch(() => setScim({ groups: [], idps: [] }))
  }, [needsCid])
  const scimGroup = (scim?.groups || []).find(g => g.id === scimGroupId)
  const [stack, setStack] = useState({ status: '', ip: '', failures: [] })
  const [csLog, setCsLog] = useState('')            // CloudShare: traffic connector install log
  const csLogRef = useRef(null)
  useEffect(() => () => clearInterval(csLogRef.current), [])
  const [running, setRunning] = useState(false)
  const pollRef = useRef(null)
  useEffect(() => () => clearInterval(pollRef.current), [])
  useEffect(() => { update({ publishConn: conn, publishSegs: segs, publishRule: rule }) }, [conn, segs, rule])

  const errOf = (e) => e.response?.data?.error || e.message

  const pollStack = async () => {
    try {
      const r = await axios.get('/api/aws/stack-status', { params: { ...aws, stackName: TRAFFIC_STACK } })
      const s = r.data.status
      setStack({ status: s, ip: r.data.outputs?.find(o => o.OutputKey === 'PrivateIp')?.OutputValue || '', failures: r.data.failures || [] })
      if (/_COMPLETE$|_FAILED$/.test(s)) clearInterval(pollRef.current)
      return s
    } catch { return null }
  }
  // Pick up a connector stack launched earlier (e.g. before a page refresh)
  useEffect(() => {
    if (!isAWS || !(data.accessKeyId || data.awsProfile)) return
    pollStack().then(s => { if (s && !/_COMPLETE$|_FAILED$/.test(s)) pollRef.current = setInterval(pollStack, 8000) })
  }, [])

  // 1. Traffic connector: group + key in ZPA, then the EC2 stack
  const doConnector = async () => {
    setConn({ state: 'running', lines: [] })
    try {
      const z = await axios.post('/api/zpa/traffic-connector', zpaAuth(data))
      const lines = [...(z.data.steps || [])]
      update({ trafficGroupId: z.data.groupId })
      if (isAWS) {
        const a = await axios.post('/api/aws/deploy-traffic-connector', {
          ...aws, vpcId: data.vpcId, subnetId: data.subnetId, keyPairName: data.keyPairName,
          provisioningKey: z.data.provisioningKey, stackName: TRAFFIC_STACK,
        })
        lines.push(a.data.reused ? `Using existing stack ${TRAFFIC_STACK}` : `Launching ${TRAFFIC_STACK} (t3.medium) in ${data.region}`)
        clearInterval(pollRef.current)
        pollRef.current = setInterval(pollStack, 8000)
        pollStack()
      }
      if (!isAWS) {
        if (data.csTestVmId && data.csApiId) {
          // The test apps VM is Zscaler's connector image: enroll it with the new key
          await axios.post(`/api/cloudshare/vms/${encodeURIComponent(data.csTestVmId)}/run-traffic-connector`,
            { apiId: data.csApiId, apiKey: data.csApiKey, provisioningKey: z.data.provisioningKey }, { timeout: 300000 })
          lines.push(`Enrolling ${data.csTestVmName || 'the test apps VM'} as the traffic connector (it already has the connector software)`)
          clearInterval(csLogRef.current)
          csLogRef.current = setInterval(async () => {
            try {
              const r = await axios.get(`/api/cloudshare/vms/${encodeURIComponent(data.csTestVmId)}/setup-log`, { params: { apiId: data.csApiId, apiKey: data.csApiKey, job: 'zpa-traffic' } })
              setCsLog(r.data.log || '')
              if (r.data.done || r.data.failed) clearInterval(csLogRef.current)
            } catch {}
          }, 10000)
        } else {
          lines.push('No test apps VM is selected on CloudShare: enroll an App Connector that can reach the test apps using the provisioning key below')
        }
      }
      setConn({ state: 'done', lines, groupId: z.data.groupId, key: isAWS || data.csTestVmId ? undefined : z.data.provisioningKey })
      return z.data.groupId
    } catch (e) { setConn({ state: 'error', lines: [], error: errOf(e) }); throw e }
  }

  // 2. App segments for the test apps, served by the traffic group (or the scanner group without one)
  const doSegments = async (groupId) => {
    setSegs({ state: 'running', lines: [] })
    try {
      const r = await axios.post('/api/zpa/test-app-segments', {
        ...zpaAuth(data), ip, connectorGroupId: groupId || data.trafficGroupId,
      })
      setSegs({ state: 'done', lines: r.data.steps || [] })
      update({ selectedSegmentIds: (r.data.segments || []).map(s => s.id) })
    } catch (e) { setSegs({ state: 'error', lines: [], error: errOf(e) }); throw e }
  }

  // 3. Access policy rule
  const doRule = async () => {
    setRule({ state: 'running', lines: [] })
    try {
      const r = await axios.post('/api/zpa/test-apps-access-rule', {
        ...zpaAuth(data), scimGroup: scimGroup ? { idpId: scimGroup.idpId, groupId: scimGroup.id, name: scimGroup.name } : null,
      })
      update({ accessScimGroupId: scimGroupId, accessScimGroupName: scimGroup?.name || '' })
      setRule({ state: 'done', lines: r.data.steps || [] })
    } catch (e) { setRule({ state: 'error', lines: [], error: errOf(e) }); throw e }
  }

  const publishAll = async () => {
    setRunning(true)
    try {
      const groupId = await doConnector()
      await doSegments(groupId)
      await doRule()
    } catch { /* the failing part shows its own error */ }
    finally { setRunning(false) }
  }

  const Part = ({ n, title, desc, part, onRetry, extra }) => (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 12, background: part.state === 'done' ? '#f0fdf4' : '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontWeight: 700 }}>{part.state === 'done' ? '✅' : part.state === 'error' ? '⚠️' : part.state === 'running' ? <span className="spinner spinner-blue" /> : `${n}.`}</span>
        <strong>{title}</strong>
      </div>
      <div style={{ fontSize: 13, color: '#475569', margin: '4px 0 0 24px' }}>{desc}</div>
      {part.lines?.length > 0 && <div style={{ margin: '6px 0 0 24px', fontSize: 13 }}>{part.lines.map((l, i) => <div key={i}>• {l}</div>)}</div>}
      {extra}
      {part.state === 'error' && (
        <div className="alert alert-error" style={{ margin: '8px 0 0 24px' }}>
          <span>{part.error} <button onClick={onRetry} disabled={running} style={{ marginLeft: 8, fontSize: 12 }}>↻ Retry</button></span>
        </div>
      )}
    </div>
  )

  const stackBox = isAWS && stack.status && (
    <div style={{ margin: '8px 0 0 24px', fontSize: 13 }}>
      Stack <code>{TRAFFIC_STACK}</code>: <strong>{stack.status}</strong>{stack.ip ? ` — ${stack.ip}` : ''}
      {stack.status === 'CREATE_COMPLETE' && <div className="hint">The connector installs itself over the next few minutes and then shows in ZPA under App Connectors, in “ZPA Shield Traffic Connectors”.</div>}
      {stack.failures.length > 0 && stack.failures.map((f, i) => <div key={i} style={{ color: '#b91c1c' }}>• {f.resource}: {f.reason}</div>)}
      {/ROLLBACK_COMPLETE|_FAILED$/.test(stack.status) && <div><button onClick={() => doConnector().catch(() => {})} style={{ fontSize: 12, marginTop: 4 }}>↻ Delete failed stack &amp; try again</button></div>}
    </div>
  )

  const allDone = segs.state === 'done' && rule.state === 'done' && conn.state === 'done'

  return (
    <div className="card">
      <h2>Publish the Test Apps through ZPA</h2>
      <p className="subtitle">
        Makes DVWA and Juice Shop reachable through ZPA: an App Connector to carry user traffic, app segments for both apps, and an access policy rule. Everything is created through the ZPA{isAWS ? ' and AWS' : ''} APIs, and running it again reuses what already exists.
      </p>

      {!ip && <div className="alert alert-warning"><span>⚠️ No test apps address yet — deploy the test apps first, or skip this step.</span></div>}
      {data.authMode === 'oneapi' && (needsCid || !data.customerId) && (
        <div className="form-group">
          <label>ZPA Customer ID</label>
          <input value={cid} placeholder="e.g. 216196257331281920" onChange={e => setCustomerId(e.target.value.trim())} />
          <div className="hint">The numeric ZPA tenant ID (Experience Center: Administration → Administration → Private Access Tenant → ZPA tenant ID) — not the Zidentity tenant ID. Normally entered once on the ZPA Login step.</div>
        </div>
      )}

      <Part n={1} title="Traffic App Connector" part={conn} onRetry={() => doConnector().catch(() => {})}
        desc={isAWS
          ? <>An ordinary App Connector in your VPC, in its own group (“ZPA Shield Traffic Connectors”), so the App Scanner group stays dedicated to scanning.</>
          : <>A connector group (“ZPA Shield Traffic Connectors”) and provisioning key, enrolled on {data.csTestVmName || 'the test apps VM'} (Zscaler’s connector image) so it also carries user traffic.</>}
        extra={isAWS ? stackBox : csLog ? (
          <pre style={{ margin: '8px 0 0 24px', maxHeight: 180, overflow: 'auto', background: '#0f172a', color: '#e2e8f0', padding: 8, borderRadius: 6, fontSize: 11, whiteSpace: 'pre-wrap' }}>{csLog}</pre>
        ) : (conn.key && (
          <div style={{ margin: '8px 0 0 24px' }}>
            <div className="hint">Provisioning key — keep it private:</div>
            <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 8, borderRadius: 6, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{conn.key}</pre>
          </div>
        ))} />
      <Part n={2} title="App segments" part={segs} onRetry={() => doSegments().catch(() => {})}
        desc={<>Nine segments at {ip || '?'}, in segment group “ZPA Shield Test Apps”: DVWA (80, TLS 443), Juice Shop (3000, HTTP 8080, TLS 8443), WebGoat (8081), Apache httpd 2.4.49 (8082), Tomcat 8.5 (8083) and WordPress 4.9 (8084). One segment per endpoint gives App Shield distinct targets to fingerprint and keeps ZPA’s per-segment scan lock from blocking everything at once.</>} />
      <Part n={3} title="Access policy rule" part={rule} onRetry={() => doRule().catch(() => {})}
        desc={<>“ZPA Shield - allow test apps” — lets users reach the ZPA Shield Test Apps segment group.</>}
        extra={(
          <div style={{ margin: '8px 0 0 24px' }}>
            <label style={{ fontSize: 13 }}>Who can access the test apps</label>
            <select value={scimGroupId} onChange={e => setScimGroupId(e.target.value)} disabled={running || rule.state === 'running'}>
              <option value="">All users</option>
              {(scim?.groups || []).map(g => <option key={g.id} value={g.id}>{g.name}{scim.idps.length > 1 ? ` (${g.idpName})` : ''}</option>)}
            </select>
            <div className="hint" style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
              {scim === null ? 'Loading groups from your identity provider...' : scim.groups.length === 0 ? 'No SCIM groups in ZPA, so the rule applies to all users — fine for a demo tenant. To scope it to a group later, set up SCIM provisioning for your IdP in ZPA and re-run this step.' : 'Pick a group (e.g. a demo or SE group) to keep the vulnerable apps away from everyone else. Changing it and clicking Retry updates the rule.'}
            </div>
          </div>
        )} />

      {allDone && (
        <div className="alert alert-success">
          <span>🎉 Published. Once {isAWS ? 'the traffic connector shows as connected in ZPA' : 'your connector is healthy'}, users with Client Connector can open http://{ip} (DVWA), http://{ip}:3000 (Juice Shop), http://{ip}:8081 (WebGoat) and the TLS/8080 aliases.</span>
        </div>
      )}

      <div className="btn-row">
        <button className="btn btn-secondary" onClick={back} disabled={running}>← Back</button>
        {!allDone && (
          <button className="btn btn-secondary" onClick={next} disabled={running} title="Skip only if the segments, server group and rule already exist in ZPA. Otherwise Verify and Scan will have nothing to check or scan.">Skip →</button>
        )}
        {allDone ? (
          <button className="btn btn-primary" onClick={next}>Continue to Verify Access →</button>
        ) : (
          <button className="btn btn-primary" onClick={publishAll} disabled={running || !ip || needsCid}>
            {running ? <><span className="spinner" /> Publishing...</> : '🚀 Publish Test Apps'}
          </button>
        )}
      </div>
    </div>
  )
}
