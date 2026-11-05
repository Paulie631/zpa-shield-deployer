import React, { useState } from 'react'
import axios from 'axios'
import { zpaAuth } from '../lib/zpa'
import { awsAuth } from '../lib/aws'

// Removes what the wizard created, so a demo can be repeated from scratch.
// Each target is opt-in; results are listed per item.
export default function TearDown({ data }) {
  const isAWS = data.target === 'aws'
  const [opts, setOpts] = useState({
    awsStacks: isAWS,
    zpaObjects: true,
    scannerGroup: false,
    clientEnv: !!data.clientEnvId,
  })
  const [state, setState] = useState('idle')   // idle | confirm | running | done
  const [results, setResults] = useState([])
  const toggle = (k) => setOpts(o => ({ ...o, [k]: !o[k] }))

  const run = async () => {
    setState('running'); setResults([])
    const out = []
    const push = (group, list) => out.push(...list.map(r => ({ group, ...r })))
    if (opts.awsStacks) {
      try {
        const r = await axios.post('/api/aws/teardown', { ...awsAuth(data), ssmParamName: data.ssmParamName || '/zpa/provisioning-key' })
        push('AWS', r.data.results)
      } catch (e) { push('AWS', [...(e.response?.data?.results || []), { item: 'AWS', ok: false, detail: e.response?.data?.error || e.message }]) }
      setResults([...out])
    }
    if (opts.zpaObjects) {
      try {
        const r = await axios.post('/api/zpa/teardown', { ...zpaAuth(data), includeScannerGroup: opts.scannerGroup, scannerGroupId: data.connectorGroupId })
        push('ZPA', r.data.results)
      } catch (e) { push('ZPA', [...(e.response?.data?.results || []), { item: 'ZPA', ok: false, detail: e.response?.data?.error || e.message }]) }
      setResults([...out])
    }
    if (opts.clientEnv && data.clientEnvId) {
      try {
        await axios.delete(`/api/cloudshare/envs/${encodeURIComponent(data.clientEnvId)}`, { params: { apiId: data.csApiId, apiKey: data.csApiKey } })
        push('CloudShare', [{ item: 'Test client environment', ok: true, detail: 'deleted' }])
      } catch (e) { push('CloudShare', [{ item: 'Test client environment', ok: false, detail: e.response?.data?.error || e.message }]) }
      setResults([...out])
    }
    setState('done')
  }

  const box = { border: '1px solid #fecaca', borderRadius: 10, padding: 16, background: '#fff7f7' }
  const Opt = ({ k, label, hint }) => (
    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14, margin: '6px 0' }}>
      <input type="checkbox" style={{ width: 'auto', marginTop: 3 }} checked={opts[k]} onChange={() => toggle(k)} disabled={state === 'running'} />
      <span><strong>{label}</strong>{hint && <div className="hint" style={{ margin: 0 }}>{hint}</div>}</span>
    </label>
  )

  return (
    <div style={box}>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>🧹 Tear down this deployment</h3>
      <div className="hint" style={{ marginBottom: 10 }}>Removes what the wizard created so you can run the demo again from scratch (and stop paying for the instances). Only objects created by this wizard are touched.</div>
      {isAWS && <Opt k="awsStacks" label="AWS stacks" hint="zpa-traffic-connector, zpa-app-scanner, zpa-test-apps — and the provisioning key in SSM" />}
      <Opt k="zpaObjects" label="ZPA objects" hint="Access rule, both test app segments, their server and segment groups, the traffic connector group with its connectors and keys" />
      <Opt k="scannerGroup" label="Also the App Scanner connector group" hint="Its connector, provisioning key and group. Leave unticked to keep the scanner enrolled." />
      {data.clientEnvId && <Opt k="clientEnv" label="CloudShare test client environment" hint="The Client Connector VM created for the access test" />}
      {!isAWS && <div className="hint" style={{ marginTop: 6 }}>CloudShare VMs for the apps and scanner are left as they are — delete them in the CloudShare portal if you no longer need them.</div>}

      {state === 'idle' && (
        <button className="btn btn-secondary" style={{ marginTop: 10, borderColor: '#dc2626', color: '#dc2626' }} onClick={() => setState('confirm')} disabled={!Object.values(opts).some(Boolean)}>
          Tear down…
        </button>
      )}
      {state === 'confirm' && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14 }}>This can’t be undone. Delete the selected items?</span>
          <button className="btn btn-primary" style={{ background: '#dc2626' }} onClick={run}>Yes, delete them</button>
          <button className="btn btn-secondary" onClick={() => setState('idle')}>Cancel</button>
        </div>
      )}
      {state === 'running' && <div style={{ marginTop: 10 }}><span className="spinner spinner-blue" /> Deleting… (AWS stacks finish in the background over a few minutes)</div>}
      {results.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          {results.map((r, i) => <div key={i}>{r.ok ? '✅' : '⚠️'} <span style={{ color: '#64748b' }}>{r.group}:</span> {r.item} — {r.detail}</div>)}
        </div>
      )}
      {state === 'done' && <div className="hint" style={{ marginTop: 8 }}>{results.every(r => r.ok) ? 'Done. Anything that failed above can be removed in the AWS console or ZPA Admin Portal.' : 'Some items couldn’t be removed — see above; remove them in the AWS console or ZPA Admin Portal.'}</div>}
    </div>
  )
}
