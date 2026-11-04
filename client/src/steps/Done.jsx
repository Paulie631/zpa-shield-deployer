import React from 'react'

export default function Done({ data, goTo }) {
  const isAWS = data.target === 'aws'
  const tenantBase = `https://${data.tenantUrl}`
  const segments = (data.appSegments || []).filter(s => (data.selectedSegmentIds || []).includes(s.id))

  return (
    <div className="card">
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 56, marginBottom: 12 }}>🛡️</div>
        <h2 style={{ fontSize: 26 }}>Deployment Complete!</h2>
        <p className="subtitle" style={{ maxWidth: 480, margin: '8px auto 0' }}>
          Your ZPA Autonomous Application Shield is deployed and scanning. Here's a summary of what was set up.
        </p>
      </div>

      <div className="summary-grid">
        <div className="summary-item">
          <div className="label">Deployment Target</div>
          <div className="value">{isAWS ? `☁️ AWS — ${data.region}` : `🖥️ CloudShare — ${data.csHostname}`}</div>
        </div>
        {isAWS && data.scannerStackName && (
          <div className="summary-item">
            <div className="label">App Scanner Stack</div>
            <div className="value">{data.scannerStackName}</div>
          </div>
        )}
        {isAWS && data.testAppsPrivateIp && (
          <div className="summary-item">
            <div className="label">Test Apps Instance</div>
            <div className="value">DVWA + Juice Shop @ {data.testAppsPrivateIp}</div>
          </div>
        )}
        <div className="summary-item">
          <div className="label">Probing Level</div>
          <div className="value">
            {data.probingLevel === 'LOW' ? '🔍 Low' : data.probingLevel === 'MEDIUM' ? '⚡ Medium' : '🔥 High'}
          </div>
        </div>
        <div className="summary-item">
          <div className="label">Scan Schedule</div>
          <div className="value">{data.frequency} at {data.startTime} UTC</div>
        </div>
        <div className="summary-item">
          <div className="label">App Segments Scanned</div>
          <div className="value">{segments.length > 0 ? segments.map(s => s.name).join(', ') : `${(data.selectedSegmentIds || []).length} segment(s)`}</div>
        </div>
        {data.scanId && (
          <div className="summary-item">
            <div className="label">Scan ID</div>
            <div className="value" style={{ fontFamily: 'monospace', fontSize: 13 }}>{data.scanId}</div>
          </div>
        )}
      </div>

      <hr className="divider" />

      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>🔗 Quick Links — ZPA Admin Portal</h3>
      <div className="portal-links">
        <a className="portal-link" href={`${tenantBase}/app#autonomousApplicationShield/scans`} target="_blank" rel="noreferrer">📋 Scans</a>
        <a className="portal-link" href={`${tenantBase}/app#autonomousApplicationShield/shield`} target="_blank" rel="noreferrer">🛡️ Shield — Findings</a>
        <a className="portal-link" href={`${tenantBase}/app#autonomousApplicationShield/shieldProfiles`} target="_blank" rel="noreferrer">⚙️ Shield Profiles</a>
        <a className="portal-link" href={`${tenantBase}/app#appProtectionLogs`} target="_blank" rel="noreferrer">📊 AppProtection Logs</a>
        <a className="portal-link" href={`${tenantBase}/app#appConnectors`} target="_blank" rel="noreferrer">🔌 App Connectors</a>
      </div>

      <hr className="divider" />

      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>📋 What to Do Next</h3>
      <ol style={{ paddingLeft: 20, fontSize: 14, lineHeight: 2, color: '#374151' }}>
        <li>Wait for the first scan to run (or trigger it manually from the Scans page)</li>
        <li>Review findings in <strong>Shield → Scan Status</strong></li>
        <li>Click <strong>Protect</strong> on your app segment</li>
        <li>Start with <strong>Monitor mode</strong> — review AppProtection logs</li>
        <li>Switch confirmed controls to <strong>Block mode</strong></li>
      </ol>

      <div className="btn-row" style={{ justifyContent: 'center', marginTop: 32 }}>
        <button className="btn btn-secondary" onClick={() => goTo(0)}>
          🔄 Start a New Deployment
        </button>
      </div>
    </div>
  )
}
