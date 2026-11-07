import React, { useState } from 'react'

export default function ChooseTarget({ data, update, next, back }) {
  const [selected, setSelected] = useState(data.target || '')

  const choose = (target) => {
    setSelected(target)
    update({ target })
  }

  return (
    <div className="card">
      <h2>Choose Deployment Target</h2>
      <p className="subtitle">Where are you deploying the ZPA App Scanner? Both paths end with the same scan configuration and protection workflow.</p>

      <div className="target-cards">
        <div className={`target-card ${selected === 'aws' ? 'selected' : ''}`} onClick={() => choose('aws')}>
          <div className="icon">☁️</div>
          <h3>Amazon Web Services</h3>
          <p>Launch a RHEL 9 EC2 instance via CloudFormation. Fully automated — we generate and deploy the stack, store your provisioning key in SSM, and poll until complete.</p>
          <span className="badge">✨ Fully Automated</span>
        </div>
        <div className={`target-card ${selected === 'cloudshare' ? 'selected' : ''}`} onClick={() => choose('cloudshare')}>
          <div className="icon">🖥️</div>
          <h3>CloudShare</h3>
          <p>Create or reuse a CloudShare environment and run everything on its VMs through the CloudShare API — test apps, traffic connector and scanner. Nothing to paste.</p>
          <span className="badge">✨ Fully Automated</span>
        </div>
      </div>

      <div className="btn-row">
        <button className="btn btn-secondary" onClick={back}>← Back</button>
        <button className="btn btn-primary" onClick={next} disabled={!selected}>
          Continue with {selected === 'aws' ? 'AWS' : selected === 'cloudshare' ? 'CloudShare' : '...'} →
        </button>
      </div>
    </div>
  )
}
