import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { zpaAuth, zpaPortalBase } from '../lib/zpa'
import { awsAuth } from '../lib/aws'

const PROBING = [
  {
    level: 'LOW',
    label: 'Low',
    icon: '🔍',
    desc: 'Port/network recon + TLS assessment. No CVE checks. Fast (5–15 min).',
    tools: 'nmap · sslyze · testssl.sh',
    colorClass: 'selected-low'
  },
  {
    level: 'MEDIUM',
    label: 'Medium',
    icon: '⚡',
    desc: 'Everything in Low plus vulnerability assessment using template-based CVE checks. Recommended for most use cases.',
    tools: 'nmap · sslyze · testssl.sh · Nuclei',
    colorClass: 'selected-medium'
  },
  {
    level: 'HIGH',
    label: 'High',
    icon: '🔥',
    desc: 'Everything in Medium plus controlled proof-of-exploitability. Confirms which CVEs are actually exploitable — fewer false positives. Takes 30–90 min.',
    tools: 'nmap · sslyze · Nuclei · Metasploit',
    colorClass: 'selected-high'
  }
]

export default function ScanConfig({ data, update, next, back }) {
  const [segments, setSegments] = useState(data.appSegments || [])
  const [loadingSegs, setLoadingSegs] = useState(false)
  const [segError, setSegError] = useState('')
  const [apiFailed, setApiFailed] = useState(false)

  // Load segments live: the credentials step can't list them in OneAPI mode (no customer ID yet),
  // and segments may have been created since.
  const loadSegments = async () => {
    setLoadingSegs(true); setSegError('')
    try {
      const r = await axios.get('/api/zpa/app-segments', { params: zpaAuth(data) })
      setSegments(r.data || [])
      update({ appSegments: r.data || [] })
    } catch (e) { setSegError(e.response?.data?.error || e.message) }
    finally { setLoadingSegs(false) }
  }
  useEffect(() => { loadSegments() }, [])

  // AWS: make sure the scanner can reach the test apps (older stacks blocked it). Idempotent.
  const [netNote, setNetNote] = useState('')
  useEffect(() => {
    if (data.target !== 'aws' || !data.vpcId) return
    axios.post('/api/aws/open-scan-paths', {
      ...awsAuth(data), vpcId: data.vpcId, scannerStack: data.scannerStackName || 'zpa-app-scanner',
    }).then(r => { const d = r.data.done || []; const skipped = d.every(x => /skipped/i.test(x)); setNetNote((skipped ? '⚠️ Network paths not opened yet: ' : '✅ Network paths for scanning are open: ') + d.join('; ') + (skipped ? ' — deploy the test apps and scanner stacks first.' : '')) })
      .catch(e => setNetNote('⚠️ Couldn’t check the AWS network rules: ' + (e.response?.data?.error || e.message)))
  }, [])

  // Scanner readiness: link the scanner group to the test apps' server group and turn on
  // Application Shield Scanning for the scanner connector (otherwise Add Scan finds no scanner)
  const [prep, setPrep] = useState({ state: 'idle', checks: [] })
  const prepareScanner = async () => {
    if (!data.connectorGroupId) { setPrep({ state: 'error', checks: [], error: 'No App Scanner connector group yet — finish the Scanner Key step first.' }); return }
    setPrep({ state: 'running', checks: [] })
    try {
      const r = await axios.post('/api/zpa/prepare-scanner', { ...zpaAuth(data), scannerGroupId: data.connectorGroupId })
      setPrep({ state: 'done', ...r.data }); update({ scannerReady: !!r.data.ready })
      if (r.data.scannerNames?.length) update({ scannerConnectorNames: r.data.scannerNames })
    } catch (e) { setPrep({ state: 'error', checks: [], error: e.response?.data?.error || e.message }) }
  }
  useEffect(() => { prepareScanner() }, [])

  const testIp = data.testAppsPrivateIp
  const testSegsExist = segments.some(s => (s.domainNames || []).includes(testIp))

  const [selectedSegments, setSelectedSegments] = useState(data.selectedSegmentIds || [])
  const [probingLevel, setProbingLevel] = useState(data.probingLevel || 'MEDIUM')
  const [frequency, setFrequency] = useState(data.frequency || 'WEEKLY')
  const [startTime, setStartTime] = useState(data.startTime || '02:00')
  const [scanName, setScanName] = useState(data.scanName || 'Shield Scan')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const toggleSegment = (id) => {
    setSelectedSegments(prev =>
      prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]
    )
  }

  const createScan = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await axios.post('/api/zpa/scan', {
        ...zpaAuth(data),
        appSegmentIds: selectedSegments,
        probingLevel,
        frequency,
        startTime,
        scanName,
        scannerConnectorId: data.connectorGroupId
      })
      update({ selectedSegmentIds: selectedSegments, probingLevel, frequency, startTime, scanName, scanProfileId: res.data.scanProfileId, scanId: res.data.scanId })
      next()
    } catch (err) {
      const raw = err.response?.data?.error || err.message
      setError(raw)   // the server already translates ZPA's errors
      setApiFailed(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <h2>Configure Scan</h2>
      <p className="subtitle">Choose which app segments to scan, how deep to probe, and how often. The scan will start automatically at the scheduled time — or you can trigger it manually from the ZPA portal.</p>

      <div className="form-group">
        <label>Scan Name</label>
        <input type="text" placeholder="Shield Scan" value={scanName} onChange={e => setScanName(e.target.value)} />
      </div>

      {netNote && <div className="hint" style={{ marginBottom: 12 }}>{netNote}</div>}

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <strong>Scanner readiness</strong>
          <button onClick={prepareScanner} disabled={prep.state === 'running'} style={{ fontSize: 12 }}>↻ Check again</button>
        </div>
        {prep.state === 'running' && <div className="hint"><span className="spinner spinner-blue" /> Preparing the App Scanner in ZPA...</div>}
        {prep.state === 'error' && <div className="alert alert-error" style={{ marginTop: 8 }}><span>⚠️ {prep.error}</span></div>}
        {prep.checks.map(c => (
          <div key={c.id} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '3px 0' }}>
            <span>{c.ok ? '✅' : '❌'}</span>
            <div><strong>{c.label}</strong>{c.detail ? <div style={{ color: '#64748b' }}>{c.detail}</div> : null}</div>
          </div>
        ))}
        {prep.state === 'done' && !prep.ready && <div className="hint" style={{ marginTop: 6 }}>Create the scan once these are green — a scan created earlier can land on a connector that never runs it, and ZPA then blocks new requests for those segments for 12 hours.</div>}
      </div>

      {testIp && !testSegsExist && !loadingSegs && (
        <div className="alert alert-warning" style={{ marginBottom: 12 }}>
          <span>⚠️ No app segments for the test apps at {testIp} yet — go back to <strong>Publish</strong> to create them, then <button onClick={loadSegments} style={{ fontSize: 12 }}>↻ Reload</button></span>
        </div>
      )}

      <div className="form-group">
        <label>App Segments to Scan <span style={{ color: '#9ca3af', fontWeight: 400 }}>({segments.filter(x => selectedSegments.includes(x.id)).length} selected)</span></label>
        {loadingSegs ? (
          <div className="hint">🔄 Loading app segments from ZPA...</div>
        ) : segError ? (
          <div className="alert alert-error"><span>⚠️ Couldn’t load app segments: {segError} <button onClick={loadSegments} style={{ marginLeft: 8, fontSize: 12 }}>↻ Retry</button></span></div>
        ) : segments.length === 0 ? (
          <div className="alert alert-warning">
            <span>⚠️ No app segments found in your ZPA tenant.{data.testAppsPrivateIp ? <> Create two for the test apps at <strong>{data.testAppsPrivateIp}</strong> — DVWA on port 80 and Juice Shop on port 3000 — </> : ' Create them '}
            in the <a href={`${zpaPortalBase(data)}`} target="_blank" rel="noreferrer">ZPA Admin Portal</a>, then <button onClick={loadSegments} style={{ fontSize: 12 }}>↻ Reload</button></span>
          </div>
        ) : (
          <div className="multi-select">
            {segments.map(seg => (
              <div key={seg.id} className={`multi-select-item ${selectedSegments.includes(seg.id) ? 'selected' : ''}`}
                onClick={() => toggleSegment(seg.id)}>
                <input type="checkbox" readOnly checked={selectedSegments.includes(seg.id)} style={{ width: 'auto', flex: 'none' }} />
                <span>{seg.name}</span>
                {seg.domainNames?.[0] && <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>{seg.domainNames[0]}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="form-group">
        <label>Probing Level</label>
        <div className="probing-cards">
          {PROBING.map(p => (
            <div key={p.level}
              className={`probing-card ${probingLevel === p.level ? p.colorClass : ''}`}
              onClick={() => setProbingLevel(p.level)}>
              <div className="level-badge">{p.icon} {p.label}</div>
              <h4>{p.label} Probing</h4>
              <p>{p.desc}</p>
              <div className="tools">{p.tools}</div>
            </div>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>💡 Medium or High recommended for production — Low has no CVE checks</div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Scan Frequency</label>
          <select value={frequency} onChange={e => setFrequency(e.target.value)}>
            <option value="DAILY">Daily</option>
            <option value="WEEKLY">Weekly</option>
            <option value="MONTHLY">Monthly</option>
          </select>
        </div>
        <div className="form-group">
          <label>Start Time (UTC, HH:MM)</label>
          <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
          <div className="hint">Schedule during off-peak hours</div>
        </div>
      </div>

      {(() => {
        const picked = segments.filter(x => selectedSegments.includes(x.id))
        const intensity = PROBING.find(p => p.level === probingLevel)?.label
        const dnsName = testIp && /^172\.31\./.test(testIp) ? `ip-${testIp.replace(/\./g, '-')}.ec2.internal` : (testIp ? `ip-${testIp.replace(/\./g, '-')}.<region>.compute.internal` : 'the VM’s private DNS name')
        return (
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, marginTop: 4 }}>
            <strong>Create the scan in the portal</strong> <span className="hint">(about a minute — Zscaler has no API for this on any auth mode)</span>
            <ol style={{ margin: '8px 0 0 18px', padding: 0, fontSize: 14 }}>
              <li>Experience Center → <strong>Private Access → Autonomous App Shield → Scans → Add</strong> (<a href="https://console.zscaler.com/private/autonomous-app-shield/scans" target="_blank" rel="noreferrer">open</a>).</li>
              <li>Name <strong>{scanName || 'Shield Scan'}</strong>, Status Enable. Scan Profile → <strong>New Scan Profile</strong>: name <strong>{scanName || 'Shield Scan'} - {intensity}</strong>, intensity <strong>{intensity}</strong>, interval <strong>{frequency.charAt(0) + frequency.slice(1).toLowerCase()}</strong>, start <strong>{startTime} UTC</strong>.</li>
              <li>Application Segments: <strong>{picked.map(x => x.name).join(', ') || '— tick at least one above —'}</strong>.</li>
              <li>App Scanner: <strong>{(data.scannerConnectorNames || []).join(' / ') || 'the ZPA-AppScanner-Key connector'}</strong> — never the traffic connector. If the list says “No Scanners available for the selected Application Segments”, the readiness checks above aren’t green yet.</li>
              <li>Save, then press <strong>▷</strong> on the scan’s row to run it now. Watch it under <strong>Autonomous App Shield → Shield</strong>: Requested → In Progress → Completed (High ≈ 10–90 min). Then <strong>Download Report</strong>, and <strong>Protection</strong> to deploy the recommended controls.</li>
            </ol>
            <div className="hint" style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>Stuck at “Requested” for 15+ minutes, or “An active scan request for this app segment already exists within the last 12 hours”? That segment is locked by an earlier request. Add a second segment for the same VM using its private DNS name <code>{dnsName}</code> (ports 80 and 3000, segment group and server group “ZPA Shield Test Apps”) and scan that instead.</div>
          </div>
        )
      })()}

      {error && (
        <div className="alert alert-error" style={{ display: 'block', marginTop: 10 }}>
          ⚠️ {error}
        </div>
      )}

      <div className="btn-row">
        <button className="btn btn-secondary" onClick={back}>← Back</button>
        <button className="btn btn-secondary" onClick={createScan} disabled={loading || selectedSegments.length === 0 || !scanName}
          title="Zscaler documents no scan API; this tries one anyway in case your tenant has it.">
          {loading ? <><span className="spinner spinner-blue" /> Trying the API...</> : 'Try creating it via API'}
        </button>
        <button className="btn btn-primary" disabled={selectedSegments.length === 0 || !scanName}
          onClick={() => { update({ selectedSegmentIds: selectedSegments, probingLevel, frequency, startTime, scanName, scanCreatedManually: true }); next() }}>
          I’ve created it in the portal — Continue →
        </button>
      </div>
    </div>
  )
}
