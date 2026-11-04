import React, { useState } from 'react'
import axios from 'axios'

export default function ZPACredentials({ data, update, next }) {
  const [authMode, setAuthMode] = useState(data.authMode || 'apikey')
  const [tenantUrl, setTenantUrl] = useState(data.tenantUrl || '')
  const [apiKey, setApiKey] = useState(data.apiKey || '')
  const [clientId, setClientId] = useState(data.clientId || '')
  const [clientSecret, setClientSecret] = useState(data.clientSecret || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const validate = async () => {
    setLoading(true)
    setError('')
    try {
      const params = { tenantUrl }
      if (authMode === 'apikey') params.apiKey = apiKey
      else { params.clientId = clientId; params.clientSecret = clientSecret }

      const res = await axios.get('/api/zpa/validate', { params })
      update({
        tenantUrl,
        authMode,
        apiKey: authMode === 'apikey' ? apiKey : undefined,
        clientId: authMode === 'oauth' ? clientId : undefined,
        clientSecret: authMode === 'oauth' ? clientSecret : undefined,
        connectorGroups: res.data.connectorGroups,
        appSegments: res.data.appSegments
      })
      next()
    } catch (err) {
      setError(err.response?.data?.error || 'Could not connect to ZPA. Check your tenant URL and credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <h2>ZPA Credentials</h2>
      <p className="subtitle">Connect to your ZPA tenant to get started. We'll validate your credentials and fetch your connector groups and app segments.</p>

      <div className="disclaimer">🔒 Credentials are used only for this request and are never stored.</div>

      <div className="form-group">
        <label>ZPA Tenant URL</label>
        <input
          type="text"
          placeholder="e.g. mycompany.private.zscaler.com"
          value={tenantUrl}
          onChange={e => setTenantUrl(e.target.value)}
          className={error ? 'error' : ''}
        />
        <div className="hint">Your ZPA Admin Portal hostname — without https://</div>
      </div>

      <div className="form-group">
        <label>Authentication Method</label>
        <div className="auth-toggle">
          <button className={`toggle-btn ${authMode === 'apikey' ? 'active' : ''}`} onClick={() => setAuthMode('apikey')}>API Key</button>
          <button className={`toggle-btn ${authMode === 'oauth' ? 'active' : ''}`} onClick={() => setAuthMode('oauth')}>OAuth (Client Credentials)</button>
        </div>
      </div>

      {authMode === 'apikey' ? (
        <div className="form-group">
          <label>API Key</label>
          <input
            type="password"
            placeholder="Paste your ZPA API key"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
          />
        </div>
      ) : (
        <>
          <div className="form-group">
            <label>Client ID</label>
            <input type="text" placeholder="OAuth Client ID" value={clientId} onChange={e => setClientId(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Client Secret</label>
            <input type="password" placeholder="OAuth Client Secret" value={clientSecret} onChange={e => setClientSecret(e.target.value)} />
          </div>
        </>
      )}

      {error && <div className="alert alert-error">⚠️ {error}</div>}

      <div className="btn-row">
        <button
          className="btn btn-primary"
          onClick={validate}
          disabled={loading || !tenantUrl || (authMode === 'apikey' ? !apiKey : !clientId || !clientSecret)}
        >
          {loading ? <><span className="spinner" /> Validating...</> : 'Connect & Continue →'}
        </button>
      </div>
    </div>
  )
}
