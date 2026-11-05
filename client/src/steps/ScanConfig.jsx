import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { zpaAuth, zpaPortalBase } from '../lib/zpa'

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

  // ── Create app segments for the test apps via the ZPA API ──
  const testIp = data.testAppsPrivateIp
  const testSegsExist = segments.some(s => (s.domainNames || []).includes(testIp))
  const [groups, setGroups] = useState(null)
  const [segGroupId, setSegGroupId] = useState('')
  const [creatingSegs, setCreatingSegs] = useState(false)
  const [segSteps, setSegSteps] = useState([])
  const [createSegError, setCreateSegError] = useState('')
  useEffect(() => {
    if (!testIp) return
    axios.get('/api/zpa/connector-groups', { params: zpaAuth(data) }).then(r => {
      const list = r.data || []
      setGroups(list)
      // Prefer a group other than the dedicated scanner group, if there is one
      const other = list.find(g => g.id !== data.connectorGroupId)
      setSegGroupId((other || list.find(g => g.id === data.connectorGroupId) || {}).id || '')
    }).catch(e => { setGroups([]); setCreateSegError('Couldn’t load App Connector groups: ' + (e.response?.data?.error || e.message)) })
  }, [testIp])

  const createTestSegments = async () => {
    setCreatingSegs(true); setCreateSegError(''); setSegSteps([])
    try {
      const r = await axios.post('/api/zpa/test-app-segments', { ...zpaAuth(data), ip: testIp, connectorGroupId: segGroupId })
      setSegSteps(r.data.steps || [])
      await loadSegments()
      setSelectedSegments(prev => [...new Set([...prev, ...(r.data.segments || []).map(s => s.id)])])
    } catch (e) { setCreateSegError(e.response?.data?.error || e.message) }
    finally { setCreatingSegs(false) }
  }
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
      setError(err.response?.data?.error || err.message)
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

      {testIp && !testSegsExist && !loadingSegs && (
        <div style={{ marginBottom: 16, padding: 14, border: '1px solid #bfdbfe', borderRadius: 8, background: '#eff6ff' }}>
          <strong>Create app segments for the test apps</strong>
          <div style={{ fontSize: 13, color: '#475569', margin: '4px 0 10px' }}>
            Creates a segment group, a server group and two app segments — DVWA ({testIp}:80) and Juice Shop ({testIp}:3000) — through the ZPA API, then selects them below.
          </div>
          <label style={{ fontSize: 13 }}>App Connector group that can reach {testIp}</label>
          <select value={segGroupId} onChange={e => setSegGroupId(e.target.value)} style={{ marginBottom: 6 }}>
            {groups === null && <option value="">Loading connector groups...</option>}
            {groups && groups.length === 0 && <option value="">No App Connector groups found — create one on the ZPA Setup step</option>}
            {(groups || []).map(g => <option key={g.id} value={g.id}>{g.name}{g.id === data.connectorGroupId ? ' (App Scanner group)' : ''}</option>)}
          </select>
          {segGroupId && segGroupId === data.connectorGroupId && (
            <div className="hint" style={{ color: '#b45309' }}>This is the App Scanner group. Zscaler recommends keeping that group dedicated to scanning; pick a traffic-forwarding group in the same network if you have one.</div>
          )}
          <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={createTestSegments} disabled={creatingSegs || !segGroupId}>
            {creatingSegs ? <><span className="spinner" /> Creating...</> : '➕ Create Test App Segments'}
          </button>
          {createSegError && <div className="alert alert-error" style={{ marginTop: 10 }}><span>⚠️ {createSegError}</span></div>}
        </div>
      )}
      {segSteps.length > 0 && (
        <div className="alert alert-success" style={{ display: 'block' }}>{segSteps.map((s, i) => <div key={i}>✅ {s}</div>)}</div>
      )}

      <div className="form-group">
        <label>App Segments to Scan <span style={{ color: '#9ca3af', fontWeight: 400 }}>({selectedSegments.length} selected)</span></label>
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
                <input type="checkbox" readOnly checked={selectedSegments.includes(seg.id)} />
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

      {error && (
        <div className="alert alert-error" style={{ display: 'block' }}>
          ⚠️ {error}
          {apiFailed && (
            <div style={{ marginTop: 6 }}>
              Zscaler doesn’t document an API for creating App Shield scans, so this call may not be supported on your tenant.
              Create the scan in the <a href={zpaPortalBase(data)} target="_blank" rel="noreferrer">ZPA Admin Portal</a> instead, then continue.
            </div>
          )}
        </div>
      )}

      <div className="btn-row">
        <button className="btn btn-secondary" onClick={back}>← Back</button>
        {apiFailed && (
          <button className="btn btn-secondary" onClick={() => { update({ selectedSegmentIds: selectedSegments, probingLevel, frequency, startTime, scanName, scanCreatedManually: true }); next() }}>
            I’ll create it in the portal — Continue →
          </button>
        )}
        <button className="btn btn-primary" onClick={createScan}
          disabled={loading || selectedSegments.length === 0 || !scanName}>
          {loading ? <><span className="spinner" /> Creating scan...</> : '✅ Create Scan & Continue →'}
        </button>
      </div>
    </div>
  )
}
