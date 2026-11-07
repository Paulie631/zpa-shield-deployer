import React from 'react'
import { zpaPortalBase } from '../lib/zpa'
import TearDown from '../components/TearDown'
import ConnectorStatus from '../components/ConnectorStatus'
import ScanProgress from '../components/ScanProgress'

export default function Done({ data, goTo, update }) {
  const isAWS = data.target === 'aws'
  const tenantBase = zpaPortalBase(data)
  const EC = 'https://console.zscaler.com/private'
  const segments = (data.appSegments || []).filter(s => (data.selectedSegmentIds || []).includes(s.id))

  return (
    <div className="card">
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div style={{ fontSize: 56, marginBottom: 12 }}>🛡️</div>
        <h2 style={{ fontSize: 26 }}>Deployment Complete!</h2>
        <p className="subtitle" style={{ maxWidth: 480, margin: '8px auto 0' }}>
          {data.scanCreatedManually ? 'Everything is deployed; the scan you created in the portal runs on its schedule (or press ▷ on it to run now).' : 'Your ZPA Autonomous Application Shield is deployed and scanning.'} Here's a summary of what was set up.
        </p>
      </div>

      <div className="summary-grid">
        <div className="summary-item">
          <div className="label">Deployment Target</div>
          <div className="value">{isAWS ? `☁️ AWS — ${data.region}` : `🖥️ CloudShare — ${data.csEnvName || data.csVmName || data.csHostname || ''}`}</div>
        </div>
        {isAWS && data.scannerStackName && (
          <div className="summary-item">
            <div className="label">App Scanner Stack</div>
            <div className="value">{data.scannerStackName}</div>
          </div>
        )}
        {data.testAppsPrivateIp && (
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

      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 10 }}>📡 Live status</h3>
      <ConnectorStatus data={data} groupNames={['ZPA Shield Traffic Connectors', data.connectorGroupName || 'ZPA-AppScanner-Group']} startedAt={data.scannerStackCompletedAt || data.trafficStackCompletedAt} title="Connectors" />
      <div style={{ height: 10 }} />
      <ScanProgress data={data} update={update} />

      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>🔗 Quick Links — Experience Center</h3>
      <div className="portal-links">
        <a className="portal-link" href={`${EC}/autonomous-app-shield/scans`} target="_blank" rel="noreferrer">📋 Scans</a>
        <a className="portal-link" href={`${EC}/autonomous-app-shield/shield`} target="_blank" rel="noreferrer">🛡️ Shield — Findings</a>
        <a className="portal-link" href={`${EC}/autonomous-app-shield/shield-profiles`} target="_blank" rel="noreferrer">⚙️ Shield Profiles</a>
        <a className="portal-link" href={`${EC}/app-connectors`} target="_blank" rel="noreferrer">🔌 App Connectors</a>
      </div>

      <hr className="divider" />

      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>📋 What to Do Next</h3>
      <ol style={{ paddingLeft: 20, fontSize: 14, lineHeight: 2, color: '#374151' }}>
        <li>Run the scan now: <strong>Scans → ▷</strong> on your scan (High takes roughly 10–90 minutes). It moves Requested → In Progress → Completed under <strong>Shield</strong>.</li>
        <li>In <strong>Shield</strong>, click <strong>Download Report</strong> — critical findings come with a ready-made control (e.g. “Block 403” for exposed source/credential paths).</li>
        <li>Prove the exposure from your Client Connector device (e.g. <code>http://{data.testAppsPrivateIp || '<test-apps-ip>'}/.git/HEAD</code>), then open the segment → <strong>Protection</strong> and deploy the control.</li>
        <li>Reload the same URL: it should now return 403 from ZPA — protected inline with no patching.</li>
        <li>For production apps start controls in <strong>Monitor</strong> mode and promote confirmed ones to <strong>Block</strong>.</li>
      </ol>

      <hr className="divider" />
      <TearDown data={data} />

      <div className="btn-row" style={{ justifyContent: 'center', marginTop: 32 }}>
        <button className="btn btn-secondary" onClick={() => goTo(0)}>
          🔄 Start a New Deployment
        </button>
      </div>
    </div>
  )
}
