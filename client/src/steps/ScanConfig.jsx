import React, { useState } from 'react'
import axios from 'axios'

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
  const segments = data.appSegments || []
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
        tenantUrl: data.tenantUrl,
        apiKey: data.apiKey,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
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

      <div className="form-group">
        <label>App Segments to Scan <span style={{ color: '#9ca3af', fontWeight: 400 }}>({selectedSegments.length} selected)</span></label>
        {segments.length === 0 ? (
          <div className="alert alert-warning">⚠️ No app segments found in your ZPA tenant. Create app segments first, then return to this step.</div>
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

      {error && <div className="alert alert-error">⚠️ {error}</div>}

      <div className="btn-row">
        <button className="btn btn-secondary" onClick={back}>← Back</button>
        <button className="btn btn-primary" onClick={createScan}
          disabled={loading || selectedSegments.length === 0 || !scanName}>
          {loading ? <><span className="spinner" /> Creating scan...</> : '✅ Create Scan & Continue →'}
        </button>
      </div>
    </div>
  )
}
