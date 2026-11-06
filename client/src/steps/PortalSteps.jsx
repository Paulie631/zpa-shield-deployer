import React, { useState } from 'react'
import { zpaPortalBase } from '../lib/zpa'

const STEPS = (base, data) => [
  {
    id: 'version-profile',
    title: data.scannerVersionProfileName ? `Version profile: done — "${data.scannerVersionProfileName}" is pinned to the scanner group` : 'Set the scanner group’s version profile',
    desc: data.scannerVersionProfileName
      ? 'The wizard set this through the ZPA API on the Scanner Key step. Just confirm it shows in the portal.'
      : 'Private Access → App Connector Groups → the AppScanner group → Edit → Version Profile: an AppShield profile if your tenant lists one, otherwise "New Release".',
    link: `${base}/app#appConnectorGroups`,
    linkLabel: '→ Open App Connector Groups'
  },
  {
    id: 'enable-scanning',
    title: data.scannerReady ? 'Application Shield Scanning: done — the Scan step turned it on' : 'Enable Application Shield Scanning on the scanner connector',
    desc: data.scannerReady
      ? 'The Scan step also linked the scanner group to the test apps’ server group. Confirm the AppScanner row shows Application Shield Scanning: Enabled.'
      : 'Private Access → App Connectors → the ZPA-AppScanner connector → Edit → Application Shield Scanning: Enabled. Leave it off on the traffic connector. Also make sure the scanner group is in the "ZPA Shield Test Apps" server group (Steering → Server Groups).',
    link: `${base}/app#appConnectors`,
    linkLabel: '→ Open App Connectors'
  },
  {
    id: 'verify-healthy',
    title: 'Verify the scanner connector is Connected',
    desc: 'App Connectors: the AppScanner row should show Connected. After a version-profile change it upgrades itself and shows Disconnected for a few minutes — wait for it rather than rebooting. Only reboot the VM if it stays disconnected for 15+ minutes.',
    link: `${base}/app#appConnectors`,
    linkLabel: '→ Check App Connectors Status'
  },
  {
    id: 'run-scan',
    title: 'Run the scan and review the results',
    desc: 'Autonomous App Shield → Scans → ▷ on your scan. A run moves Requested → In Progress → Completed (High: roughly 10–90 minutes). Then Shield → Download Report, and Protection to deploy the recommended controls (e.g. a Block 403 rule).',
    link: null
  }
]

export default function PortalSteps({ data, update, next, back }) {
  const steps = STEPS(zpaPortalBase(data), data)
  const [checked, setChecked] = useState(data.portalStepsChecked || {})

  const toggle = (id) => {
    const next_ = { ...checked, [id]: !checked[id] }
    setChecked(next_)
    update({ portalStepsChecked: next_ })
  }

  const allDone = steps.every(s => checked[s.id])

  return (
    <div className="card">
      <h2>Manual ZPA Portal Steps</h2>
      <p className="subtitle">
        These steps can't be automated yet — they require clicks in the ZPA Admin Portal. Complete each one and check it off. The App Scanner won't appear in scan configuration until scanning is enabled.
      </p>

      <div className="alert alert-warning">
        ⚠️ <strong>Order matters:</strong> Install Docker and assign the version profile <em>before</em> enabling scanning mode.
      </div>

      <ul className="checklist">
        {steps.map((s, i) => (
          <li key={s.id} className={checked[s.id] ? 'done' : ''}>
            <input type="checkbox" checked={!!checked[s.id]} onChange={() => toggle(s.id)} />
            <div className="check-content">
              <h4>{i + 1}. {s.title}</h4>
              <p>{s.desc}</p>
              {s.link && (
                <a href={s.link} target="_blank" rel="noreferrer">{s.linkLabel}</a>
              )}
            </div>
            {checked[s.id] && <span style={{ fontSize: 20 }}>✅</span>}
          </li>
        ))}
      </ul>

      {allDone && (
        <div className="alert alert-success" style={{ marginTop: 16 }}>
          🎉 All portal steps complete — your App Scanner is ready to scan!
        </div>
      )}

      <div className="btn-row">
        <button className="btn btn-secondary" onClick={back}>← Back</button>
        <button className="btn btn-primary" onClick={next}>
          {allDone ? 'Finish →' : 'Continue Anyway →'}
        </button>
      </div>
    </div>
  )
}
