import React, { useState, useEffect } from 'react'
import axios from 'axios'

// Remember the ZPA Customer ID per tenant so it only has to be entered once.
// (OneAPI has no endpoint to look it up, so it can't be discovered automatically.)
const CID_STORAGE_KEY = 'zpa-shield-customer-ids'
function loadSavedCid(tenantKey) {
  try { return JSON.parse(localStorage.getItem(CID_STORAGE_KEY) || '{}')[tenantKey] || '' } catch { return '' }
}
function saveCid(tenantKey, cid) {
  try {
    const all = JSON.parse(localStorage.getItem(CID_STORAGE_KEY) || '{}')
    all[tenantKey] = cid
    localStorage.setItem(CID_STORAGE_KEY, JSON.stringify(all))
  } catch {}
}

export default function ZPASetup({ data, update, next, back }) {
  const tenantKey = data.vanityDomain || data.tenantUrl || 'default'
  const authParams = {
    authMode: data.authMode,
    tenantUrl: data.tenantUrl,
    apiKey: data.apiKey,
    clientId: data.clientId,
    clientSecret: data.clientSecret,
    cloudEnv: data.cloudEnv,
    vanityDomain: data.vanityDomain,
  }

  const isAWS = data.target === 'aws'

  // Data from API
  const [customerId, setCustomerId] = useState(data.customerId || loadSavedCid(tenantKey))
  const [customerIdInput, setCustomerIdInput] = useState(data.customerId || loadSavedCid(tenantKey))
  const [connectorGroups, setConnectorGroups] = useState(data.connectorGroups || [])
  const [serverGroups, setServerGroups]       = useState([])
  const [enrollmentCerts, setEnrollmentCerts] = useState([])
  const [provisioningKeys, setProvisioningKeys] = useState([])
  const [loadingData, setLoadingData]         = useState(false)
  const [loadError, setLoadError]             = useState('')
  const [tokenClaims, setTokenClaims]           = useState(null)
  const [debuggingToken, setDebuggingToken]     = useState(false)

  // Form state
  const [provisioningKey, setProvisioningKey]     = useState(data.provisioningKey || '')
  const [connectorGroupId, setConnectorGroupId]   = useState(data.connectorGroupId || '')
  const [serverGroupId, setServerGroupId]         = useState(data.serverGroupId || '')
  const [serverGroupName, setServerGroupName]     = useState(data.serverGroupName || '')
  const [ssmParamName, setSsmParamName]           = useState(data.ssmParamName || '/zpa/provisioning-key')

  // Create-new state
  const [showNewGroup, setShowNewGroup]           = useState(false)
  const [newGroupName, setNewGroupName]           = useState('ZPA-AppScanner-Group')
  const [showNewKey, setShowNewKey]               = useState(false)
  const [newKeyName, setNewKeyName]               = useState('ZPA-AppScanner-Key')
  const [selectedCertId, setSelectedCertId]       = useState('')
  const [creating, setCreating]                   = useState(false)
  const [createMsg, setCreateMsg]                 = useState('')

  // Load all data on mount
  useEffect(() => {
    loadAll()
  }, [])

  const apiQuery = (extra = {}) => ({ ...authParams, customerId, ...extra })

  const loadAll = async (cidOverride) => {
    setLoadingData(true); setLoadError('')
    try {
      let cid = cidOverride || customerId || customerIdInput
      if (!cid) {
        try {
          const custRes = await axios.get('/api/zpa/customer', { params: authParams })
          cid = custRes.data?.id || ''
          setCustomerId(cid)
          setCustomerIdInput(cid)
        } catch { /* customerId optional — routes fall back to base path */ }
      } else {
        setCustomerId(cid)
      }

      if (authParams.authMode === 'oneapi' && !/^\d+$/.test(cid || '')) {
        if (cid) setLoadError('ZPA Customer ID must be the numeric ZPA tenant ID (digits only), not the Zidentity tenant ID.')
        return
      }

      const params = { ...authParams, customerId: cid }
      if (/^\d+$/.test(cid || '')) saveCid(tenantKey, cid)

      // Fetch connector groups, enrollment certs, provisioning keys in parallel
      const [cgRes, certRes, keyRes, sgRes] = await Promise.allSettled([
        axios.get('/api/zpa/connector-groups', { params }),
        axios.get('/api/zpa/enrollment-certs', { params }),
        axios.get('/api/zpa/provisioning-keys', { params }),
        axios.get('/api/zpa/server-groups', { params }),
      ])

      if (cgRes.status === 'fulfilled') {
        const groups = cgRes.value.data || []
        setConnectorGroups(groups)
        // Auto-select if only one or if previously selected
        // Don't default to the traffic-forwarding group created by Publish Apps
        const candidates = groups.filter(g => g.id !== data.trafficGroupId)
        if (!connectorGroupId && candidates.length === 1) setConnectorGroupId(candidates[0].id)
      } else {
        const e = cgRes.reason
        setLoadError(e?.response?.data?.error || e?.message || 'Could not load connector groups')
      }
      if (certRes.status === 'fulfilled') {
        const certs = certRes.value.data || []
        setEnrollmentCerts(certs)
        // Auto-select Connector cert
        const connCert = certs.find(c => /connector/i.test(c.name))
        if (connCert) setSelectedCertId(connCert.id)
      }
      if (keyRes.status === 'fulfilled') {
        setProvisioningKeys(keyRes.value.data || [])
      }
      if (sgRes.status === 'fulfilled') {
        const sgs = sgRes.value.data || []
        setServerGroups(sgs)
        if (!serverGroupId && sgs.length === 1) { setServerGroupId(sgs[0].id); setServerGroupName(sgs[0].name) }
      }
    } catch (err) {
      setLoadError(err.response?.data?.error || err.message)
    } finally {
      setLoadingData(false)
    }
  }

  // Debug: decode token claims
  const debugToken = async () => {
    setDebuggingToken(true); setTokenClaims(null)
    try {
      const res = await axios.get('/api/zpa/debug-token', { params: authParams })
      setTokenClaims(res.data)
    } catch (err) {
      setTokenClaims({ error: err.response?.data?.error || err.message })
    } finally { setDebuggingToken(false) }
  }

  // Create a new connector group
  const createConnectorGroup = async () => {
    const cid = customerId || customerIdInput
    setCreating(true); setCreateMsg('Creating connector group...')
    try {
      const res = await axios.post('/api/zpa/connector-groups', {
        ...authParams, customerId: cid,
        name: newGroupName,
        description: 'App Scanner connector group — created by ZPA Shield Deployer',
      })
      const newGroup = res.data
      setConnectorGroups(prev => [...prev, newGroup])
      setConnectorGroupId(newGroup.id)
      setShowNewGroup(false)
      setCreateMsg(`✅ Created connector group: ${newGroup.name}`)
      setTimeout(() => setCreateMsg(''), 4000)
    } catch (err) {
      setCreateMsg(`❌ ${err.response?.data?.error || err.message} ${err.response?.data?.url ? '[' + err.response.data.url + ']' : ''}`)
    } finally { setCreating(false) }
  }

  // Create a new provisioning key
  const createProvisioningKey = async () => {
    const cid = customerId || customerIdInput
    if (!connectorGroupId) { setCreateMsg('❌ Select a connector group first'); return }
    if (!selectedCertId) { setCreateMsg('❌ No enrollment certificate found'); return }
    setCreating(true); setCreateMsg('Creating provisioning key...')
    try {
      const res = await axios.post('/api/zpa/provisioning-keys', {
        ...authParams, customerId: cid,
        name: newKeyName,
        maxUsage: '10',
        connectorGroupId,
        enrollmentCertId: selectedCertId,
      })
      const key = res.data
      setProvisioningKeys(prev => [...prev, key])
      setProvisioningKey(key.provisioningKey || key.key || key.value || JSON.stringify(key))
      setShowNewKey(false)
      setCreateMsg(`✅ Provisioning key created and filled in below`)
      setTimeout(() => setCreateMsg(''), 5000)
    } catch (err) {
      setCreateMsg(`❌ ${err.response?.data?.error || err.message}`)
    } finally { setCreating(false) }
  }

  const canContinue = provisioningKey && connectorGroupId

  const handleContinue = () => {
    update({
      provisioningKey,
      connectorGroupId,
      connectorGroupName: connectorGroups.find(g => g.id === connectorGroupId)?.name || connectorGroupId,
      serverGroupId,
      serverGroupName: serverGroups.find(g => g.id === serverGroupId)?.name || serverGroupName,
      customerId,
      ssmParamName,
    })
    next()
  }

  return (
    <div className="card">
      <h2>ZPA Connector Setup</h2>
      <p className="subtitle">
        Configure the App Connector provisioning details. The wizard can create the connector group and provisioning key for you via the ZPA API.
      </p>

      <div className="disclaimer">
        🔒 Your provisioning key is {isAWS ? 'stored in AWS SSM Parameter Store as a SecureString and never logged.' : 'embedded in the setup script — keep the script file secure.'}
      </div>

      {loadingData && (
        <div style={{ color: '#2563eb', fontSize: '14px', margin: '12px 0' }}>🔄 Loading ZPA configuration via API...</div>
      )}
      {loadError && (
        <div className="alert alert-warning" style={{ marginBottom: '12px' }}>
          {loadError.includes('No handler found') || loadError.includes('resource.not.found') ? (
            <>
              <strong>🔐 API Client missing ZPA permissions</strong><br/>
              Your OneAPI token is valid but your API client hasn't been granted ZPA Admin access in Zidentity.<br/>
              <strong>Fix in 2 steps:</strong>
              <ol style={{ marginTop: '6px', marginBottom: '6px', paddingLeft: '18px' }}>
                <li>Go to <a href="https://admin.zidentity.net" target="_blank" rel="noreferrer">admin.zidentity.net</a> → <strong>API Clients</strong> → your client</li>
                <li>Add role: <strong>ZPA Admin</strong> (or Super Admin) → Save</li>
              </ol>
              Then <button onClick={() => loadAll(customerId)} style={{ fontSize: '12px', padding: '2px 8px', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', background: 'none' }}>Retry</button>
              &nbsp;or switch to <strong>API Key</strong> auth mode on step 1 to bypass this.
            </>
          ) : (
            <>
              ⚠️ Couldn’t load ZPA data automatically: {loadError}
              <button onClick={() => loadAll(customerId)} style={{ marginLeft: '10px', fontSize: '12px', padding: '2px 8px', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', background: 'none' }}>Retry</button>
            </>
          )}
        </div>
      )}

      {/* Customer ID — needed for mgmtconfig API calls */}
      {authParams.authMode === 'oneapi' && (
        <div style={{ marginBottom: '10px' }}>
          <button onClick={debugToken} disabled={debuggingToken}
            style={{ fontSize: '12px', padding: '4px 10px', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', background: '#f9fafb' }}>
            {debuggingToken ? '...' : '🔍 Inspect Token Claims'}
          </button>
          {tokenClaims && !tokenClaims.error && (
            <div style={{ marginTop: '8px', padding: '8px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '4px', fontSize: '12px' }}>
              <strong>Token Claims:</strong><br/>
              <b>aud:</b> {JSON.stringify(tokenClaims.aud)}<br/>
              <b>scp/scope:</b> {JSON.stringify(tokenClaims.scp) || '(none)'}<br/>
              <b>roles:</b> {JSON.stringify(tokenClaims.roles) || '(none)'}<br/>
              <b>sub:</b> {tokenClaims.sub}<br/>
              <b>exp:</b> {tokenClaims.exp}
            </div>
          )}
          {tokenClaims?.error && <span style={{ marginLeft: '8px', color: '#dc2626', fontSize: '12px' }}>{tokenClaims.error}</span>}
        </div>
      )}
      <div className="form-group">
        <label>ZPA Customer ID</label>
        <input type="text"
          placeholder="e.g. 216196257331281920"
          value={customerIdInput}
          onChange={e => setCustomerIdInput(e.target.value.trim())}
          onBlur={e => { const v = e.target.value.trim(); setCustomerIdInput(v); setCustomerId(v); if (v) loadAll(v); }}
        />
        <div className="hint">The numeric ZPA tenant ID (digits only) — <strong>not</strong> the Zidentity tenant ID. Find it in the ZPA console under <strong>Configuration &amp; Control → Public API → API Keys</strong>.</div>
        {customerIdInput && !/^\d+$/.test(customerIdInput) && (
          <div className="hint" style={{ color: '#dc2626' }}>This doesn’t look like a ZPA Customer ID — it should be digits only.</div>
        )}
      </div>
      {createMsg && (
        <div className={`alert ${createMsg.startsWith('✅') ? 'alert-info' : 'alert-error'}`} style={{ marginBottom: '12px' }}>
          {createMsg}
        </div>
      )}

      {/* ── Connector Group ── */}
      <div className="form-group">
        <label>App Connector Group <span className="label-required">*</span></label>
        {connectorGroups.length > 0 ? (
          <select value={connectorGroupId} onChange={e => setConnectorGroupId(e.target.value)}>
            <option value="">— Select or create a dedicated group —</option>
            {connectorGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        ) : !loadingData ? (
          <input type="text" placeholder="No groups found — create one below"
            value={connectorGroupId} onChange={e => setConnectorGroupId(e.target.value)} />
        ) : null}
        <div className="hint">Must be a dedicated group — do not mix with traffic-forwarding connectors.</div>
        {connectorGroupId && connectorGroupId === data.trafficGroupId && (
          <div className="hint" style={{ color: '#dc2626' }}>⚠️ That is the traffic-forwarding group created by Publish Apps. The App Scanner needs its own group — create a new one below.</div>
        )}

        {!showNewGroup ? (
          <button onClick={() => setShowNewGroup(true)} disabled={creating}
            style={{ marginTop: '8px', fontSize: '13px', padding: '5px 12px', background: 'none', border: '1px solid #2563eb', borderRadius: '6px', cursor: 'pointer', color: '#2563eb' }}>
            ➕ Create new connector group
          </button>
        ) : (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '14px', marginTop: '10px' }}>
            <div style={{ fontWeight: 600, marginBottom: '8px', fontSize: '13px' }}>New App Connector Group</div>
            <input type="text" value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
              placeholder="Group name" style={{ marginBottom: '8px', width: '100%' }} />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-primary" onClick={createConnectorGroup} disabled={creating || !newGroupName}
                style={{ fontSize: '13px' }}>
                {creating ? '⏳ Creating...' : '✅ Create Group'}
              </button>
              <button onClick={() => setShowNewGroup(false)} disabled={creating}
                style={{ fontSize: '13px', padding: '6px 12px', background: 'none', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Provisioning Key ── */}
      <div className="form-group">
        <label>ZPA Provisioning Key <span className="label-required">*</span></label>

        {/* Existing keys picker */}
        {provisioningKeys.length > 0 && (
          <div style={{ marginBottom: '8px' }}>
            <select onChange={e => {
              const k = provisioningKeys.find(k => k.id === e.target.value)
              if (k) setProvisioningKey(k.provisioningKey || k.key || k.value || '')
            }} defaultValue="">
              <option value="">— Use an existing key —</option>
              {provisioningKeys.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
        )}

        <textarea
          placeholder="Paste your provisioning key here, or create one below..."
          value={provisioningKey}
          onChange={e => setProvisioningKey(e.target.value)}
          rows={4}
        />
        <div className="hint">
          Provisioning key from ZPA Admin Portal → Infrastructure → App Connectors → Provisioning Keys.
        </div>

        {/* Create new key */}
        {!showNewKey ? (
          <button onClick={() => setShowNewKey(true)} disabled={creating || !connectorGroupId}
            style={{ marginTop: '8px', fontSize: '13px', padding: '5px 12px', background: 'none', border: '1px solid #2563eb', borderRadius: '6px', cursor: 'pointer', color: '#2563eb' }}
            title={!connectorGroupId ? 'Select a connector group first' : ''}>
            ➕ Create new provisioning key via API
          </button>
        ) : (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '14px', marginTop: '10px' }}>
            <div style={{ fontWeight: 600, marginBottom: '8px', fontSize: '13px' }}>New Provisioning Key</div>
            <input type="text" value={newKeyName} onChange={e => setNewKeyName(e.target.value)}
              placeholder="Key name" style={{ marginBottom: '8px', width: '100%' }} />
            {enrollmentCerts.length > 0 && (
              <div style={{ marginBottom: '8px', fontSize: '13px' }}>
                <label>Enrollment Certificate</label>
                <select value={selectedCertId} onChange={e => setSelectedCertId(e.target.value)}>
                  {enrollmentCerts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px' }}>
              <button className="btn btn-primary" onClick={createProvisioningKey} disabled={creating || !newKeyName}
                style={{ fontSize: '13px' }}>
                {creating ? '⏳ Creating...' : '✅ Create Key'}
              </button>
              <button onClick={() => setShowNewKey(false)} disabled={creating}
                style={{ fontSize: '13px', padding: '6px 12px', background: 'none', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Server Group ── */}
      <div className="form-group">
        <label>Server Group</label>
        {serverGroups.length > 0 ? (
          <select value={serverGroupId} onChange={e => {
            setServerGroupId(e.target.value)
            setServerGroupName(serverGroups.find(g => g.id === e.target.value)?.name || '')
          }}>
            <option value="">— Optional: select a server group —</option>
            {serverGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        ) : (
          <input type="text" placeholder="e.g. zpa-scanner-server-group"
            value={serverGroupName} onChange={e => setServerGroupName(e.target.value)} />
        )}
        <div className="hint">Optional — dedicated or existing server group for your target app segments.</div>
      </div>

      {/* ── SSM param (AWS only) ── */}
      {isAWS && (
        <div className="form-group">
          <label>SSM Parameter Name</label>
          <input type="text" placeholder="/zpa/provisioning-key"
            value={ssmParamName} onChange={e => setSsmParamName(e.target.value)} />
          <div className="hint">The provisioning key will be stored as a SecureString at this SSM path.</div>
        </div>
      )}

      <div className="btn-row">
        <button className="btn btn-secondary" onClick={back}>← Back</button>
        <button className="btn btn-primary" onClick={handleContinue} disabled={!canContinue}>
          Continue →
        </button>
      </div>
    </div>
  )
}
