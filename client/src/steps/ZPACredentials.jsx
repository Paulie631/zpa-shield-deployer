import React, { useState } from 'react'
import axios from 'axios'

const CLOUD_ENVS = [
  { value: 'zscaler.com',      label: 'Zscaler (zscaler.com) — most common' },
  { value: 'zscalertwo.net',   label: 'Zscaler Two (zscalertwo.net)' },
  { value: 'zscalerthree.net', label: 'Zscaler Three (zscalerthree.net)' },
  { value: 'zscloud.net',      label: 'ZS Cloud (zscloud.net)' },
  { value: 'zscalerone.net',   label: 'Zscaler One (zscalerone.net)' },
  { value: 'zscalerbeta.net',  label: 'Zscaler Beta (zscalerbeta.net)' },
]

const GUIDES = {
  apikey: {
    title: 'Where to find your API Key',
    steps: [
      'Log in to your ZPA Admin Portal',
      'Go to Administration → API Key Management',
      'Click Add API Key, give it a name, and copy the key',
    ],
    docsUrl: 'https://help.zscaler.com/zpa/about-api-keys'
  },
  oauth: {
    title: 'Where to find your Client ID & Secret',
    steps: [
      'Log in to your ZPA Admin Portal',
      'Go to Administration → API Key Management → OAuth 2.0 Clients',
      'Click Add Client, choose Client Credentials, copy the Client ID and Secret',
    ],
    docsUrl: 'https://help.zscaler.com/zpa/oauth-2.0-client-credentials'
  },
  oneapi: {
    title: 'Where to find your OneAPI credentials',
    steps: [
      'Go to console.zscaler.com and log in as an admin',
      'Navigate to Private Access → Client Credentials (direct URL: console.zscaler.com/private/client-credentials)',
      'Click Add Client, set grant type to Client Credentials, copy the Client ID and Secret',
      'Your Vanity Domain is shown on the client details page — it is the prefix before .zslogin.net (e.g. "acme" from acme.zslogin.net)',
      'Select the Cloud Environment below that matches your ZPA tenant',
    ],
    docsUrl: 'https://automate.zscaler.com/docs/getting-started/getting-started'
  }
}

function stripUrl(raw) {
  return raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim()
}

export default function ZPACredentials({ data, update, next }) {
  const [authMode, setAuthMode] = useState(data.authMode || 'apikey')
  const [tenantUrl, setTenantUrl] = useState(data.tenantUrl || '')
  const [apiKey, setApiKey] = useState(data.apiKey || '')
  const [clientId, setClientId] = useState(data.clientId || '')
  const [clientSecret, setClientSecret] = useState(data.clientSecret || '')
  const [cloudEnv, setCloudEnv] = useState(data.cloudEnv || 'zscaler.com')
  const [vanityDomain, setVanityDomain] = useState(data.vanityDomain || '')
  const [showApiKey, setShowApiKey] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const guide = GUIDES[authMode]
  const isOneApi = authMode === 'oneapi'

  const canSubmit = (isOneApi ? (clientId && clientSecret && vanityDomain) : tenantUrl) &&
    (authMode === 'apikey' ? apiKey : clientId && clientSecret)

  const validate = async () => {
    setLoading(true)
    setError('')
    console.log('[ZPA] validate called, authMode:', authMode, 'vanityDomain:', JSON.stringify(vanityDomain), 'cloudEnv:', cloudEnv)
    try {
      const params = { authMode }
      if (!isOneApi) params.tenantUrl = tenantUrl
      if (authMode === 'apikey') params.apiKey = apiKey
      else { params.clientId = clientId; params.clientSecret = clientSecret }
      if (isOneApi) { params.cloudEnv = cloudEnv; params.vanityDomain = vanityDomain; }

      const res = await axios.get('/api/zpa/validate', { params })

      update({
        authMode,
        tenantUrl: isOneApi ? null : tenantUrl,
        cloudEnv: isOneApi ? cloudEnv : null,
        vanityDomain: isOneApi ? vanityDomain : null,
        apiKey: authMode === 'apikey' ? apiKey : undefined,
        clientId: authMode !== 'apikey' ? clientId : undefined,
        clientSecret: authMode !== 'apikey' ? clientSecret : undefined,
        connectorGroups: res.data.connectorGroups,
        appSegments: res.data.appSegments,
        apiBase: res.data.base
      })
      next()
    } catch (err) {
      const data = err.response?.data
      const msg = data?.error || data?.message || err.message || ''
      const httpStatus = data?.httpStatus ? ` HTTP ${data.httpStatus}` : ''
      const reqUrl = data?.requestUrl ? ` [${data.requestUrl}]` : ''
      const rawStr = data?.raw ? ' | ' + JSON.stringify(data.raw).slice(0, 200) : ''
      if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized') || msg.includes('invalid_client')) {
        setError(`Invalid credentials — double-check your Client ID, Secret, and Vanity Domain.${httpStatus}${reqUrl}`)
      } else if (msg.includes('ENOTFOUND') || msg.includes('network') || msg.includes('connect') || msg.includes('ECONNREFUSED')) {
        setError(`Can't reach the API endpoint — check your Vanity Domain (it becomes {vanity}.zslogin.net).${reqUrl}`)
      } else {
        setError(`${msg || 'Connection failed.'}${httpStatus}${reqUrl}${rawStr}`)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <h2>Connect to ZPA</h2>
      <p className="subtitle">
        Enter your ZPA tenant details. We'll verify the connection and load your App Connector groups and app segments.
      </p>

      <div className="disclaimer">🔒 Credentials are used only for this session and are never stored or logged.</div>

      {/* Auth mode selector */}
      <div className="form-group">
        <label>How do you want to authenticate?</label>
        <div className="auth-mode-cards">
          {[
            { id: 'apikey', icon: '🔑', label: 'API Key', sub: 'Most common' },
            { id: 'oauth',  icon: '🔐', label: 'OAuth 2.0', sub: 'Client credentials' },
            { id: 'oneapi', icon: '🌐', label: 'OneAPI', sub: 'Zidentity / api.zscaler.com' },
          ].map(m => (
            <div
              key={m.id}
              className={`auth-mode-card ${authMode === m.id ? 'selected' : ''}`}
              onClick={() => { setAuthMode(m.id); setError('') }}
            >
              <span className="auth-mode-icon">{m.icon}</span>
              <div>
                <div className="auth-mode-label">{m.label}</div>
                <div className="auth-mode-sub">{m.sub}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tenant URL — not needed for OneAPI */}
      {!isOneApi && (
        <div className="form-group">
          <label>ZPA Tenant URL <span className="label-required">*</span></label>
          <div className="input-with-prefix">
            <span className="input-prefix">https://</span>
            <input
              type="text"
              placeholder="mycompany.private.zscaler.com"
              value={tenantUrl}
              onChange={e => { setTenantUrl(stripUrl(e.target.value)); setError('') }}
              onPaste={e => { e.preventDefault(); setTenantUrl(stripUrl(e.clipboardData.getData('text'))); setError('') }}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="hint">
            Found in your browser address bar when logged into ZPA. You can paste the full URL — we'll clean it up.
          </div>
        </div>
      )}

      {/* Vanity domain + Cloud environment for OneAPI */}
      {isOneApi && (
        <>
          <div className="form-group">
            <label>Vanity Domain <span className="label-required">*</span></label>
            <div className="input-prefix-wrap">
              <input
                type="text"
                placeholder="yourcompany"
                value={vanityDomain}
                onChange={e => setVanityDomain(e.target.value.toLowerCase())}
                onBlur={e => setVanityDomain(e.target.value.trim().toLowerCase())}
              />
              <span className="input-suffix">.zslogin.net</span>
            </div>
            <div className="hint">Your Zscaler company slug. If your login URL is <strong>acme.zslogin.net</strong>, enter <strong>acme</strong>. Found on your OneAPI client page.</div>
            {vanityDomain && <div className="hint" style={{color:'#16a34a',fontWeight:600}}>✓ Token endpoint: https://{vanityDomain}.zslogin.net/oauth2/v1/token</div>}
          </div>
          <div className="form-group">
            <label>Cloud Environment <span className="label-required">*</span></label>
            <select value={cloudEnv} onChange={e => setCloudEnv(e.target.value)}>
              {CLOUD_ENVS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
            <div className="hint">Match this to your ZPA tenant's cloud. Check your ZPA Admin Portal URL if unsure.</div>
          </div>
        </>
      )}

      {/* Where to find guide */}
      <div className="find-guide">
        <div className="find-guide-title">📍 {guide.title}</div>
        <ol className="find-guide-steps">
          {guide.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
        <a href={guide.docsUrl} target="_blank" rel="noreferrer" className="find-guide-link">
          ZPA Docs ↗
        </a>
      </div>

      {/* Credentials */}
      {authMode === 'apikey' ? (
        <div className="form-group">
          <label>API Key <span className="label-required">*</span></label>
          <div className="input-with-reveal">
            <input
              type={showApiKey ? 'text' : 'password'}
              placeholder="Paste your API key here"
              value={apiKey}
              onChange={e => { setApiKey(e.target.value); setError('') }}
              autoComplete="off" spellCheck={false}
            />
            <button className="reveal-btn" onClick={() => setShowApiKey(v => !v)} tabIndex={-1}>
              {showApiKey ? '🙈 Hide' : '👁 Show'}
            </button>
          </div>
        </div>
      ) : (
        <div className="form-row">
          <div className="form-group">
            <label>Client ID <span className="label-required">*</span></label>
            <input
              type="text"
              placeholder={isOneApi ? 'Zidentity Client ID' : 'OAuth Client ID'}
              value={clientId}
              onChange={e => { setClientId(e.target.value); setError('') }}
              autoComplete="off" spellCheck={false}
            />
          </div>
          <div className="form-group">
            <label>Client Secret <span className="label-required">*</span></label>
            <div className="input-with-reveal">
              <input
                type={showSecret ? 'text' : 'password'}
                placeholder={isOneApi ? 'Zidentity Client Secret' : 'OAuth Client Secret'}
                value={clientSecret}
                onChange={e => { setClientSecret(e.target.value); setError('') }}
                autoComplete="off" spellCheck={false}
              />
              <button className="reveal-btn" onClick={() => setShowSecret(v => !v)} tabIndex={-1}>
                {showSecret ? '🙈 Hide' : '👁 Show'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OneAPI notice */}
      {isOneApi && (
        <div className="alert alert-warning">
          ⚠️ <strong>OneAPI is in active rollout.</strong> App Shield scan endpoints may not yet be available via OneAPI — if scan creation fails, switch to API Key or OAuth. All other wizard steps will work.
        </div>
      )}

      {error && (
        <div className="alert alert-error">
          ⚠️ {error}
          <div style={{ marginTop: 6, fontSize: 12 }}>
            Need help? <a href="https://help.zscaler.com/zpa" target="_blank" rel="noreferrer" style={{ color: '#991b1b' }}>ZPA Docs ↗</a>
          </div>
        </div>
      )}

      <div className="btn-row">
        <button
          className="btn btn-primary"
          onClick={validate}
          disabled={loading || !canSubmit}
          style={{ minWidth: 220 }}
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
