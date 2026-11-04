import React, { useState } from 'react'

export default function CloudShareConfig({ data, update, next, back }) {
  const [form, setForm] = useState({
    csHostname: data.csHostname || '',
    csUser: data.csUser || 'ec2-user',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="card">
      <h2>CloudShare VM Details</h2>
      <p className="subtitle">Enter your CloudShare VM details. We'll generate a fully pre-filled setup script you can paste directly into the terminal.</p>

      <div className="alert alert-info">
        ℹ️ <strong>Coming soon:</strong> Full CloudShare API automation for one-click VM provisioning. For now, paste the generated script into your CloudShare VM terminal.
      </div>

      <div className="form-group">
        <label>VM Hostname / IP Address</label>
        <input type="text" placeholder="e.g. 10.0.1.50 or vm-hostname.cloudshare.com"
          value={form.csHostname} onChange={e => set('csHostname', e.target.value)} />
        <div className="hint">Used to label the generated script — does not need to be reachable from this browser</div>
      </div>

      <div className="form-group">
        <label>SSH Username</label>
        <input type="text" placeholder="ec2-user" value={form.csUser}
          onChange={e => set('csUser', e.target.value)} />
      </div>

      <div className="alert alert-warning">
        ⚠️ <strong>Before running the script:</strong> Verify your CloudShare VM has outbound TCP/443 open to Zscaler endpoints and <code>*.private.zscaler.com</code>. Run <code>lsblk</code> first to confirm disk device names match — the script auto-detects LVM layout but will warn if it can't.
      </div>

      <div className="btn-row">
        <button className="btn btn-secondary" onClick={back}>← Back</button>
        <button className="btn btn-primary" onClick={() => { update(form); next() }} disabled={!form.csHostname}>
          Continue →
        </button>
      </div>
    </div>
  )
}
