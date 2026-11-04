import React, { useState } from 'react'
import axios from 'axios'

const WHERE_TO_FIND = {
  apikey: {
    steps: [
      { n: 1, text: 'Log in to your ZPA Admin Portal' },
      { n: 2, text: 'Go to Administration → API Key Management' },
      { n: 3, text: 'Click Add API Key, give it a name, and copy the key' },
    ],
    docsUrl: 'https://help.zscaler.com/zpa/about-api-keys'
  },
  oauth: {
    steps: [
      { n: 1, text: 'Log in to your ZPA Admin Portal' },
      { n: 2, text: 'Go to Administration → API Key Management → OAuth 2.0 Clients' },
      { n: 3, text: 'Click Add Client, choose Client Credentials, and copy the Client ID and Secret' },
    ],
    docsUrl: 'https://help.zscaler.com/zpa/oauth-2.0-client-credentials'
  }
}

function urlToTenant(raw) {
  // Strip https://, http://, trailing slashes so user can paste the full URL
  return raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim()
}

export default function ZPACredentials({ data, update, next }) {
  const [authMode, setAuthMode] = useState(data.authMode || 'apikey')
  const [tenantUrl, setTenantUrl] = useState(data.tenantUrl || '')
  const [apiKey, setApiKey] = useState(data.apiKey || '')
  const [clientId, setClientId] = useState(data.clientId || '')
  const [clientSecret, setClientSecret] = useState(data.clientSecret || '')
  const [showApiKey, setShowApiKey] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const guide = WHERE_TO_FIND[authMode]

  const handleTenantInput = (val) => {
    setTenantUrl(urlToTenant(val))
    setError('')
  }

  const canSubmit = tenantUrl && (authMode === 'apikey' ? apiKey : clientId && clientSecret)

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
      const msg = err.response?.data?.error || err.message || ''
      if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized')) {
        setError('Invalid credentials — double-check your API key and tenant URL.')
      } else if (msg.includes('ENOTFOUND') || msg.includes('network') || msg.includes('connect')) {
        setError(`Can't reach ${tenantUrl} — check the tenant URL and your internet connection.`)
      } else {
        setError(msg || 'Connection failed. Check your tenant URL and credentials.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <h2>Connect to ZPA</h2>
      <p className="subtitle">
        Enter your ZPA tenant details below. We'll verify the connection and load your App Connector groups and app segments — this takes about 5 seconds.
      </p>

      <div className="disclaimer">🔒 Credentials are used only for this session and are never stored or logged.</div>

      {/* Tenant URL */}
      <div className="form-group">
        <label>
          ZPA Tenant URL
          <span className="label-required"> *</span>
        </label>
        <div className="input-with-prefix">
          <span className="input-prefix">https://</span>
          <input
            type="text"
            placeholder="mycompany.private.zscaler.com"
            value={tenantUrl}
            onChange={e => handleTenantInput(e.target.value)}
            onPaste={e => {
              e.preventDefault()
              handleTenantInput(e.clipboardData.getData('text'))
            }}
            className={error && !tenantUrl ? 'error' : ''}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="hint">
          Found in your browser's address bar when logged into ZPA —
          e.g. <code>acme.private.zscaler.com</code> or <code>admin.zpa.zscaler.com</code>.
          You can paste the full URL and we'll clean it up.
        </div>
      </div>

      {/* Auth method toggle */}
      <div className="form-group">
        <label>How do you want to authenticate?</label>
        <div className="auth-toggle">
          <button
            className={`toggle-btn ${authMode === 'apikey' ? 'active' : ''}`}
            onClick={() => { setAuthMode('apikey'); setError('') }}
          >
            🔑 API Key <span style={{fontWeight:400, fontSize:11}}>(most common)</span>
          </button>
          <button
            className={`toggle-btn ${authMode === 'oauth' ? 'active' : ''}`}
            onClick={() => { setAuthMode('oauth'); setError('') }}
          >
            🔐 OAuth 2.0 <span style={{fontWeight:400, fontSize:11}}>(client credentials)</span>
          </button>
        </div>
      </div>

      {/* Where to find it guide */}
      <div className="find-guide">
        <div className="find-guide-title">📍 Where to find your {authMode === 'apikey' ? 'API key' : 'Client ID & Secret'}</div>
        <ol className="find-guide-steps">
          {guide.steps.map(s => (
            <li key={s.n}>{s.text}</li>
          ))}
        </ol>
        <a href={guide.docsUrl} target="_blank" rel="noreferrer" className="find-guide-link">
          ZPA Docs ↗
        </a>
      </div>

      {/* Credentials fields */}
      {authMode === 'apikey' ? (
        <div className="form-group">
          <label>API Key <span className="label-required"> *</span></label>
          <div className="input-with-reveal">
            <input
              type={showApiKey ? 'text' : 'password'}
              placeholder="Paste your API key here"
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setError('') }}
              autoComplete="off"
              spellCheck={false}
            />
            <button className="reveal-btn" onClick={() => setShowApiKey(v => !v)} tabIndex={-1}>
              {showApiKey ? '🙈 Hide' : '👁 Show'}
            </button>
          </div>
        </div>
      ) : (
        <div className="form-row">
          <div className="form-group">
            <label>Client ID <span className="label-required"> *</span></label>
            <input
              type="text"
              placeholder="e.g. 3a8f2c..."
              value={clientId}
              onChange={e => { setClientId(e.target.value); setError('') }}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="form-group">
            <label>Client Secret <span className="label-required"> *</span></label>
            <div className="input-with-reveal">
              <input
                type={showSecret ? 'text' : 'password'}
                placeholder="Paste your client secret"
                value={clientSecret}
                onChange={e => { setClientSecret(e.target.value); setError('') }}
                autoComplete="off"
                spellCheck={false}
              />
              <button className="reveal-btn" onClick={() => setShowSecret(v => !v)} tabIndex={-1}>
                {showSecret ? '🙈 Hide' : '👁 Show'}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          ⚠️ {error}
          <div style={{ marginTop: 6, fontSize: 12 }}>
            Need help? Check the <a href="https://help.zscaler.com/zpa" target="_blank" rel="noreferrer" style={{ color: '#991b1b' }}>ZPA docs ↗</a>
          </div>
        </div>
      )}

      <div className="btn-row">
        <button
          className="btn btn-primary"
          onClick={validate}
          disabled={loading || !canSubmit}
          style={{ minWidth: 200 }}
        >
          {loading
            ? <><span className="spinner" /> Connecting to ZPA...</>
            : canSubmit
              ? '🔌 Connect & Continue →'
              : 'Fill in the fields above to continue'}
        </button>
      </div>
    </div>
  )
}
