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
      <p className="subtitle">
        Fill in your CloudShare VM details below. The next step will generate a ready-to-run bash script —
        just open your VM's terminal and paste it in.
      </p>

      {/* How this works */}
      <div className="alert alert-info" style={{ marginBottom: '20px' }}>
        <strong>📋 How this works — 3 steps:</strong>
        <ol style={{ margin: '8px 0 0 0', paddingLeft: '20px', lineHeight: '1.8' }}>
          <li>Fill in your VM hostname/IP and SSH username below</li>
          <li>Click <strong>Continue</strong> — the next screen shows your fully pre-filled setup script</li>
          <li>Copy the script, open a terminal in your CloudShare VM, and paste it</li>
        </ol>
        <div style={{ marginTop: '10px', fontSize: '13px', color: '#64748b' }}>
          💡 <strong>Coming soon:</strong> One-click CloudShare API automation. For now, the script method takes about 2 minutes.
        </div>
      </div>

      {/* VM details */}
      <div className="form-group">
        <label>VM Hostname / IP Address <span className="label-required">*</span></label>
        <input
          type="text"
          placeholder="e.g. 10.0.1.50 or vm-abc123.cloudshare.com"
          value={form.csHostname}
          onChange={e => set('csHostname', e.target.value)}
        />
        <div className="hint">
          Find this in CloudShare: open your environment → click the VM → look for <strong>SSH / Connection Details</strong>.
          This is used to label your script — the browser doesn't connect to it directly.
        </div>
      </div>

      <div className="form-group">
        <label>SSH Username</label>
        <input
          type="text"
          placeholder="ec2-user"
          value={form.csUser}
          onChange={e => set('csUser', e.target.value)}
        />
        <div className="hint">Default is <code>ec2-user</code> for RHEL VMs in CloudShare. Change if your environment uses a different user.</div>
      </div>

      {/* Pre-flight checklist */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
        <div style={{ fontWeight: 600, marginBottom: '10px' }}>✅ Pre-flight checklist — confirm before running the script:</div>
        <ul style={{ margin: 0, paddingLeft: '20px', lineHeight: '2', fontSize: '14px' }}>
          <li>VM is running <strong>RHEL 9</strong> (App Scanner requires RPM — won't work on Ubuntu/Debian)</li>
          <li>VM has <strong>outbound TCP/443</strong> open to <code>*.private.zscaler.com</code> and <code>*.zscaler.com</code></li>
          <li>VM has at least <strong>16 CPU / 16 GB RAM / 120 GB free in <code>/var</code></strong></li>
          <li>Run <code>lsblk</code> in the VM first — the script auto-detects disk layout but will warn you if anything looks off</li>
        </ul>
      </div>

      <div className="btn-row">
        <button className="btn btn-secondary" onClick={back}>← Back</button>
        <button
          className="btn btn-primary"
          onClick={() => { update(form); next() }}
          disabled={!form.csHostname}
        >
          Generate Script →
        </button>
      </div>
    </div>
  )
}
