import React, { useState } from 'react'

export default function ZPASetup({ data, update, next, back }) {
  const [form, setForm] = useState({
    provisioningKey: data.provisioningKey || '',
    connectorGroupId: data.connectorGroupId || '',
    serverGroupName: data.serverGroupName || '',
    ssmParamName: data.ssmParamName || '/zpa/provisioning-key',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const groups = data.connectorGroups || []
  const isAWS = data.target === 'aws'

  return (
    <div className="card">
      <h2>ZPA Connector Setup</h2>
      <p className="subtitle">Configure the ZPA App Connector provisioning details. The provisioning key links this instance to your ZPA tenant.</p>

      <div className="disclaimer">🔒 Your provisioning key is {isAWS ? 'stored in AWS SSM Parameter Store as a SecureString and never logged.' : 'embedded in the setup script — keep the script file secure.'}</div>

      <div className="form-group">
        <label>ZPA Provisioning Key</label>
        <textarea
          placeholder="Paste your App Connector provisioning key here..."
          value={form.provisioningKey}
          onChange={e => set('provisioningKey', e.target.value)}
          rows={4}
        />
        <div className="hint">Generate this in ZPA Admin Portal → Infrastructure → App Connectors → Add → Provisioning Key</div>
      </div>

      <div className="form-group">
        <label>App Connector Group</label>
        {groups.length > 0 ? (
          <select value={form.connectorGroupId} onChange={e => set('connectorGroupId', e.target.value)}>
            <option value="">-- Select a dedicated App Scanner group --</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        ) : (
          <input type="text" placeholder="App Connector Group name"
            value={form.connectorGroupId} onChange={e => set('connectorGroupId', e.target.value)} />
        )}
        <div className="hint">Must be a dedicated group — do not mix with traffic-forwarding connectors</div>
      </div>

      <div className="form-group">
        <label>Server Group Name</label>
        <input type="text" placeholder="e.g. zpa-scanner-server-group"
          value={form.serverGroupName} onChange={e => set('serverGroupName', e.target.value)} />
        <div className="hint">Dedicated or existing server group associated with your target app segments</div>
      </div>

      {isAWS && (
        <div className="form-group">
          <label>SSM Parameter Name</label>
          <input type="text" placeholder="/zpa/provisioning-key"
            value={form.ssmParamName} onChange={e => set('ssmParamName', e.target.value)} />
          <div className="hint">The provisioning key will be stored as a SecureString at this SSM path</div>
        </div>
      )}

      <div className="btn-row">
        <button className="btn btn-secondary" onClick={back}>← Back</button>
        <button className="btn btn-primary"
          onClick={() => { update(form); next() }}
          disabled={!form.provisioningKey || !form.connectorGroupId}>
          Continue →
        </button>
      </div>
    </div>
  )
}
