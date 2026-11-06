import React, { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { zpaAuth, zpaPortalBase } from '../lib/zpa'
import { loadCSCreds, saveCSCreds, csSecretSaved, PROJECT_ID, POLICY_ID, REGION_MIAMI, looksLikeZccBlueprint } from '../lib/cloudshare'

// Prove the test apps are reachable through ZPA before any scanner work:
//   A. ZPA-side checks (connector online, segments, access rule) via the ZPA API
//   B. a CloudShare VM with Zscaler Client Connector requests the apps (CloudShare API),
//      in its own environment so ZPA is the only way it can reach them
//   C. a manual check in that VM's browser
export default function VerifyAccess({ data, update, next, back }) {
  const ip = data.testAppsPrivateIp
  const urls = ip ? [`http://${ip}/`, `http://${ip}:3000/`] : []
  const labels = { [`http://${ip}/`]: 'DVWA', [`http://${ip}:3000/`]: 'Juice Shop' }

  // ── A. ZPA checks
  const [zpa, setZpa] = useState({ state: 'idle', checks: [] })
  const runZpaChecks = async () => {
    setZpa({ state: 'running', checks: [] })
    try {
      const r = await axios.post('/api/zpa/verify-publish', { ...zpaAuth(data), ip })
      setZpa({ state: 'done', checks: r.data.checks || [], allOk: r.data.allOk })
    } catch (e) { setZpa({ state: 'error', checks: [], error: e.response?.data?.error || e.message }) }
  }
  useEffect(() => { runZpaChecks() }, [])

  // ── B. Test client on CloudShare
  const saved = loadCSCreds()
  const [apiId, setApiId] = useState(data.csApiId || saved.apiId || '')
  const [apiKey, setApiKey] = useState('')
  const [keySaved, setKeySaved] = useState(false)
  const [connected, setConnected] = useState(false)
  const [csError, setCsError] = useState('')
  const [envs, setEnvs] = useState([])
  const [blueprints, setBlueprints] = useState([])
  const [mode, setMode] = useState(data.clientEnvId ? 'existing' : 'create')   // 'create' | 'existing'
  const [bpId, setBpId] = useState('')
  const [envId, setEnvId] = useState(data.clientEnvId || '')
  const [envDetail, setEnvDetail] = useState(null)
  const [vmId, setVmId] = useState(data.clientVmId || '')
  const [creating, setCreating] = useState('')
  const pollRef = useRef(null)
  useEffect(() => () => clearInterval(pollRef.current), [])

  const connect = async () => {
    setCsError('')
    try {
      const r = await axios.get('/api/cloudshare/validate', { params: { apiId, apiKey } })
      saveCSCreds({ apiId, apiKey })
      if (apiKey) { setKeySaved(true); setApiKey('') }
      setEnvs(r.data.environments || [])
      setConnected(true)
      const b = await axios.get('/api/cloudshare/blueprints', { params: { apiId, apiKey, projectId: PROJECT_ID } }).catch(() => ({ data: [] }))
      const list = (Array.isArray(b.data) ? b.data : []).sort((x, y) => (looksLikeZccBlueprint(y.name) - looksLikeZccBlueprint(x.name)) || x.name.localeCompare(y.name))
      setBlueprints(list)
      setBpId(data.clientBlueprintId || list.find(x => looksLikeZccBlueprint(x.name))?.id || '')
    } catch (e) { setCsError(e.response?.data?.error || e.message) }
  }
  useEffect(() => { csSecretSaved().then(s => { setKeySaved(s); if (apiId && s) connect() }) }, [])

  const loadEnv = async (id) => {
    if (!id) { setEnvDetail(null); return null }
    const r = await axios.get(`/api/cloudshare/envs/${id}`, { params: { apiId, apiKey } })
    setEnvDetail(r.data)
    const vms = r.data.vms || []
    const pick = vms.find(v => v.id === vmId) || vms.find(v => /windows/i.test(v.os || '')) || vms[0]
    if (pick) setVmId(pick.id)
    return r.data
  }
  useEffect(() => { if (connected && envId) loadEnv(envId).catch(e => setCsError(e.response?.data?.error || e.message)) }, [connected, envId])

  const createClientEnv = async () => {
    setCsError(''); setCreating('🚀 Creating the test client environment...')
    try {
      const bp = blueprints.find(b => b.id === bpId)
      const r = await axios.post('/api/cloudshare/envs', {
        apiId, apiKey, projectId: PROJECT_ID, policyId: POLICY_ID, blueprintId: bpId, regionId: REGION_MIAMI,
        envName: `ZPA Test Client ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
        description: `ZCC test client (${bp?.name || 'blueprint'}) — created by ZPA Shield Deployer`,
      })
      const id = r.data.environmentId
      if (!id) throw new Error('CloudShare returned no environment ID')
      setEnvId(id); setMode('existing')
      update({ clientEnvId: id, clientBlueprintId: bpId })
      let n = 0
      pollRef.current = setInterval(async () => {
        n++
        try {
          const d = await loadEnv(id)
          setCreating(`⏳ Environment: ${d.statusText} — VMs: ${(d.vms || []).map(v => v.statusText).join(', ') || 'none yet'}`)
          if (d.statusText === 'Ready' && (d.vms || []).every(v => /running|ready/i.test(v.statusText || ''))) { clearInterval(pollRef.current); setCreating('') }
          if (n > 90) { clearInterval(pollRef.current); setCreating('⚠️ Still preparing after ~12 minutes — check CloudShare, then come back.') }
        } catch {}
      }, 8000)
    } catch (e) { setCreating(''); setCsError(e.response?.data?.error || e.message) }
  }

  const vm = envDetail?.vms?.find(v => v.id === vmId)
  const vmRunning = vm && /running|ready/i.test(vm.statusText || '')
  const inScannerEnv = envId && envId === data.csEnvId

  // ── run the reachability check on the VM
  const [check, setCheck] = useState(data.clientCheck || null)   // { state, results, zcc, os, error }
  const runClientCheck = async () => {
    setCheck({ state: 'running' })
    update({ clientEnvId: envId, clientVmId: vmId })
    try {
      const r = await axios.post(`/api/cloudshare/vms/${encodeURIComponent(vmId)}/check-apps`, { apiId, apiKey, urls })
      const c = { state: 'done', ...r.data }
      setCheck(c); update({ clientCheck: c })
    } catch (e) { setCheck({ state: 'error', error: e.response?.data?.error || e.message }) }
  }

  // ── C. manual confirmation
  const [manual, setManual] = useState(data.manualVerify || '')
  const setManualResult = (v) => { setManual(v); update({ manualVerify: v }) }

  const clientOk = check?.state === 'done' && check.results?.every(r => r.ok)
  const verified = clientOk || manual === 'works'
  const failedCheck = zpa.checks.find(c => !c.ok)

  const row = (ok, label, detail, key) => (
    <div key={key} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '4px 0' }}>
      <span>{ok ? '✅' : '❌'}</span>
      <div><strong>{label}</strong>{detail ? <div style={{ color: '#64748b' }}>{detail}</div> : null}</div>
    </div>
  )
  const box = { border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 12 }

  return (
    <div className="card">
      <h2>Verify Access through ZPA</h2>
      <p className="subtitle">Before adding the scanner, prove a user can reach DVWA and Juice Shop through ZPA: the wizard checks what’s published in ZPA, then has a CloudShare VM with Zscaler Client Connector open both apps.</p>

      {!ip && <div className="alert alert-warning"><span>⚠️ No test apps address yet — deploy and publish the test apps first.</span></div>}

      {/* A */}
      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>1. ZPA configuration</strong>
          <button onClick={runZpaChecks} disabled={zpa.state === 'running'} style={{ fontSize: 12 }}>↻ Check again</button>
        </div>
        {zpa.state === 'running' && <div className="hint"><span className="spinner spinner-blue" /> Checking ZPA...</div>}
        {zpa.state === 'error' && <div className="alert alert-error" style={{ marginTop: 8 }}><span>⚠️ {zpa.error}</span></div>}
        {zpa.checks.map(c => row(c.ok, c.label, c.detail, c.id))}
        {zpa.state === 'done' && zpa.checks.find(c => c.id === 'rule')?.ok && (
          <div style={{ marginTop: 10, padding: 10, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }}>
            <strong>Will the user you sign in with get access?</strong> Three things have to be true:
            <ol style={{ margin: '6px 0 0 18px', padding: 0 }}>
              <li>The user is in <strong>this tenant</strong> ({data.vanityDomain ? `${data.vanityDomain}.zslogin.net` : 'your Zidentity tenant'}) and signs in to Client Connector with it. A Zidentity hosted-DB user is fine.</li>
              <li>The user is covered by the rule — it currently allows <strong>{zpa.checks.find(c => c.id === 'rule').scope}</strong>.{/members of/.test(zpa.checks.find(c => c.id === 'rule').scope || '') ? ' Check the user is in that group in Zidentity (Administration → Groups), or go back to Publish and choose All users.' : ''}</li>
              <li>In Zidentity, the user has the <strong>Private Access</strong> service entitlement (Administration → Users → the user → Services). Without it, ZCC signs in but ZPA stays off for that user.</li>
            </ol>
            <div className="hint" style={{ marginTop: 6 }}>Quickest proof: sign in to Client Connector on any Mac or PC outside the VPC (your personal laptop works) with that user and open <code>http://{ip}</code> — then click “Both apps load” below.</div>
          </div>
        )}
      </div>

      {/* B */}
      <div style={box}>
        <strong>2. Test from a Client Connector VM (CloudShare)</strong>
        {!connected ? (
          <div style={{ marginTop: 8 }}>
            <div className="form-row">
              <div className="form-group"><label>CloudShare API ID</label><input value={apiId} onChange={e => setApiId(e.target.value)} /></div>
              <div className="form-group"><label>CloudShare API Key</label><input type="password" placeholder={keySaved ? '•••••••• saved on this Mac' : ''} value={apiKey} onChange={e => setApiKey(e.target.value)} /></div>
            </div>
            <button className="btn btn-secondary" onClick={connect} disabled={!apiId || !(apiKey || keySaved)}>Connect to CloudShare</button>
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 16, fontSize: 13, marginBottom: 8 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" style={{ width: 'auto' }} checked={mode === 'create'} onChange={() => setMode('create')} /> New environment from a blueprint</label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" style={{ width: 'auto' }} checked={mode === 'existing'} onChange={() => setMode('existing')} /> Existing environment</label>
            </div>
            {mode === 'create' ? (
              <>
                <select value={bpId} onChange={e => setBpId(e.target.value)}>
                  <option value="">— Choose your Client Connector blueprint —</option>
                  {blueprints.map(b => <option key={b.id} value={b.id}>{looksLikeZccBlueprint(b.name) ? '★ ' : ''}{b.name}</option>)}
                </select>
                <div className="hint">Your blueprint’s VM should already have Client Connector installed and signed in. It goes in its own environment, so ZPA is its only way to reach the test apps.</div>
                <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={createClientEnv} disabled={!bpId || !!creating}>🚀 Create test client</button>
              </>
            ) : (
              <select value={envId} onChange={e => { setEnvId(e.target.value); setVmId('') }}>
                <option value="">— Choose an environment —</option>
                {envs.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            )}
            {creating && <div className="alert alert-info" style={{ marginTop: 8 }}><span>{creating}</span></div>}
            {envDetail?.vms?.length > 0 && (
              <select value={vmId} onChange={e => setVmId(e.target.value)} style={{ marginTop: 8 }}>
                {envDetail.vms.map(v => <option key={v.id} value={v.id}>{v.name} — {v.os} — {v.statusText}</option>)}
              </select>
            )}
            {inScannerEnv && <div className="hint" style={{ color: '#b45309' }}>This is the environment with your apps/scanner — a VM here may reach the apps directly, bypassing ZPA. A separate environment gives a real test.</div>}
            {vm && !vmRunning && <div className="hint" style={{ color: '#b45309' }}>{vm.name} is {vm.statusText} — start it to run the check.</div>}
            {vm && (
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={runClientCheck} disabled={!vmRunning || !urls.length || check?.state === 'running'}>
                  {check?.state === 'running' ? <><span className="spinner" /> Checking from {vm.name}...</> : '🔎 Check access from this VM'}
                </button>
                {vm.webAccessUrl && <a className="btn btn-secondary" href={vm.webAccessUrl} target="_blank" rel="noreferrer">🖥️ Open VM in browser</a>}
              </div>
            )}
            {check?.state === 'error' && <div className="alert alert-error" style={{ marginTop: 8 }}><span>⚠️ Couldn’t run the check on the VM: {check.error}. Use the manual check below instead.</span></div>}
            {check?.state === 'done' && (
              <div style={{ marginTop: 8 }}>
                {row(!!check.zcc && !/not found|stopped/i.test(check.zcc), 'Client Connector on the VM', check.zcc || 'No Zscaler service found on this VM', 'zcc')}
                {check.results.map(r => row(r.ok, `${labels[r.url] || r.url} (${r.url})`, r.ok ? `Reached — HTTP ${r.result}` : r.result, r.url))}
              </div>
            )}
          </div>
        )}
        {csError && <div className="alert alert-error" style={{ marginTop: 8 }}><span>⚠️ {csError}</span></div>}
      </div>

      {/* C */}
      <div style={box}>
        <strong>3. Check it yourself</strong>
        <div className="hint">On any device with Client Connector signed in to this tenant — the test VM above, or your own laptop — open <code>http://{ip || '…'}</code> (DVWA login page) and <code>http://{ip || '…'}:3000</code> (Juice Shop).</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className={`btn ${manual === 'works' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setManualResult('works')}>✅ Both apps load</button>
          <button className={`btn ${manual === 'fails' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setManualResult('fails')}>❌ They don’t load</button>
        </div>
        {manual === 'fails' && (
          <div className="alert alert-warning" style={{ marginTop: 8, display: 'block' }}>
            {failedCheck ? <>Start with the red item above: <strong>{failedCheck.label}</strong> — {failedCheck.detail}</>
              : <>ZPA looks correct, so check Client Connector on the VM: is ZPA “On” and the user signed in? Is the user covered by the access rule? You can also look at <a href={zpaPortalBase(data)} target="_blank" rel="noreferrer">Diagnostics in the ZPA Admin Portal</a>.</>}
          </div>
        )}
      </div>

      {verified && <div className="alert alert-success"><span>🎉 Verified — the test apps are reachable through ZPA. Next: set up the App Scanner.</span></div>}

      <div className="btn-row">
        <button className="btn btn-secondary" onClick={back}>← Back</button>
        {!verified && <button className="btn btn-secondary" onClick={next}>Skip →</button>}
        <button className="btn btn-primary" onClick={next} disabled={!verified}>Continue to Scanner Setup →</button>
      </div>
    </div>
  )
}
