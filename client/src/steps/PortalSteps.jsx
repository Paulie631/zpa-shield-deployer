import React, { useState } from 'react'
import { zpaPortalBase } from '../lib/zpa'

const STEPS = (base, data) => [
  {
    id: 'version-profile',
    title: data.scannerVersionProfileName ? `Version profile: done — "${data.scannerVersionProfileName}" is pinned to the scanner group` : 'Assign AppShield 1.0 Scanner Version Profile',
    desc: data.scannerVersionProfileName
      ? 'The wizard set this through the ZPA API on the Scanner Key step. Just confirm it shows in the portal.'
      : 'In the ZPA Admin Portal, edit your App Connector Group → Version Profile Configuration → set to Custom → select "AppShield 1.0 scanner profile". (The Scanner Key step can do this for you if the profile is visible to your tenant.)',
    link: `${base}/app#appConnectorGroups`,
    linkLabel: '→ Open App Connector Groups'
  },
  {
    id: 'enable-scanning',
    title: 'Enable Application Shield Scanning on the Connector',
    desc: 'Go to App Connectors, edit your newly deployed App Scanner connector, and set "Application Shield Scanning" to Enabled. Do this AFTER assigning the version profile.',
    link: `${base}/app#appConnectors`,
    linkLabel: '→ Open App Connectors'
  },
  {
    id: 'reboot',
    title: 'Reboot the App Connector Host',
    desc: 'After assigning the version profile, reboot the EC2/VM instance to complete the profile update. The connector will reconnect automatically.',
    link: null
  },
  {
    id: 'verify-healthy',
    title: 'Verify Connector Shows Healthy',
    desc: 'Return to App Connectors and confirm your App Scanner shows as Connected and Healthy (green). This may take 2–3 minutes after reboot.',
    link: `${base}/app#appConnectors`,
    linkLabel: '→ Check App Connectors Status'
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
