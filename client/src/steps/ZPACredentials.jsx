import React, { useState } from 'react'
import axios from 'axios'
import { savedCustomerId, rememberCustomerId } from '../lib/zpa'

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
      'Go to console.zscaler.com (Experience Center) and log in as an admin',
      'API client: Administration → API → OneAPI → API Clients → Add. Give it the ZPA resource (Administration → API → API Resources lists what it can reach) and copy the Client ID and Secret — the secret is shown once',
      'Vanity Domain: the prefix of your admin login URL before .zslogin.net (e.g. "acme" from acme.zslogin.net); it is also shown on the API client page',
      'ZPA Customer ID: Administration → Administration → Private Access Tenant (console.zscaler.com/private/company) → the "ZPA tenant ID" field — digits only',
      'Cloud Environment (above): match the cloud in your ZPA tenant name/URL (e.g. zscalertwo.net → Zscaler Two)',
    ],
    docsUrl: 'https://automate.zscaler.com/docs/getting-started/getting-started'
  }
}

function stripUrl(raw) {
  return raw.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim()
}

const STORAGE_KEY = 'zpa-shield-credentials'

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { return {} }
}

function saveCreds(obj) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)) } catch {}
}

export default function ZPACredentials({ data, update, next }) {
  const saved = loadSaved()
  const [authMode, setAuthMode] = useState(data.authMode || saved.authMode || 'oneapi')
  const [showLegacy, setShowLegacy] = useState((data.authMode || saved.authMode || 'oneapi') !== 'oneapi')
  const [tenantUrl, setTenantUrl] = useState(data.tenantUrl || saved.tenantUrl || '')
  const [apiKey, setApiKey] = useState(data.apiKey || saved.apiKey || '')
  const [clientId, setClientId] = useState(data.clientId || saved.clientId || '')
  const [customerId, setCustomerId] = useState(data.customerId || savedCustomerId(data) || '')
  const [clientSecret, setClientSecret] = useState(data.clientSecret || saved.clientSecret || '')
  const [cloudEnv, setCloudEnv] = useState(data.cloudEnv || saved.cloudEnv || 'zscaler.com')
  const [vanityDomain, setVanityDomain] = useState(data.vanityDomain || saved.vanityDomain || '')
  const [showApiKey, setShowApiKey] = useState(false)
  const [showSecret, setShowSecret] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const guide = GUIDES[authMode]
  const isOneApi = authMode === 'oneapi'

  // Non-secret fields are remembered in the browser; secrets (client secret / API key) are kept
  // by the backend in an owner-only file on this machine and filled in server-side when blank.
  const [vault, setVault] = useState(null)   // { stored, secrets: [...] } for zpa
  React.useEffect(() => {
    axios.get('/api/vault').then(r => setVault(r.data.zpa || { stored: false, secrets: [] })).catch(() => setVault({ stored: false, secrets: [] }))
  }, [])
  const secretSaved = (name) => !!vault?.secrets?.includes(name)
  React.useEffect(() => {
    saveCreds({ authMode, tenantUrl, clientId, cloudEnv, vanityDomain })
  }, [authMode, tenantUrl, clientId, cloudEnv, vanityDomain])

  const clearSaved = async () => {
    localStorage.removeItem(STORAGE_KEY)
    try { await axios.delete('/api/vault/zpa') } catch {}
    setVault({ stored: false, secrets: [] })
    setTenantUrl(''); setApiKey(''); setClientId(''); setClientSecret(''); setVanityDomain('')
  }

  const haveSecret = authMode === 'apikey' ? (apiKey || secretSaved('apiKey')) : (clientSecret || secretSaved('clientSecret'))
  const canSubmit = (isOneApi ? (clientId && haveSecret && vanityDomain && /^\d+$/.test(customerId)) : tenantUrl) &&
    (authMode === 'apikey' ? haveSecret : clientId && haveSecret)

  const validate = async () => {
    setLoading(true)
    setError('')
    console.log('[ZPA] validate called, authMode:', authMode, 'vanityDomain:', JSON.stringify(vanityDomain), 'cloudEnv:', cloudEnv)
    try {
      const params = { authMode }
      if (!isOneApi) params.tenantUrl = tenantUrl
      if (authMode === 'apikey') params.apiKey = apiKey
      else { params.clientId = clientId; params.clientSecret = clientSecret }
      if (isOneApi) { params.cloudEnv = cloudEnv; params.vanityDomain = vanityDomain; params.customerId = customerId; }

      const res = await axios.get('/api/zpa/validate', { params })

      // Validated: keep the secrets on this machine, out of the browser
      await axios.put('/api/vault/zpa', {
        authMode, tenantUrl: isOneApi ? '' : tenantUrl, cloudEnv, vanityDomain, clientId,
        ...(authMode === 'apikey' ? (apiKey ? { apiKey } : {}) : (clientSecret ? { clientSecret } : {})),
      }).catch(() => {})
      setApiKey(''); setClientSecret('')
      if (isOneApi) rememberCustomerId({ ...data, vanityDomain, cloudEnv }, customerId)

      update({
        authMode,
        tenantUrl: isOneApi ? null : tenantUrl,
        cloudEnv: isOneApi ? cloudEnv : null,
        vanityDomain: isOneApi ? vanityDomain : null,
        apiKey: undefined,
        clientId: authMode !== 'apikey' ? clientId : undefined,
        clientSecret: undefined,
        customerId: isOneApi ? customerId : data.customerId,
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

      <div className="disclaimer">🔒 Credentials go only to Zscaler. The secret is kept in an owner-only file on this Mac (~/.zpa-shield), never in the browser.</div>
      {(Object.keys(loadSaved()).length > 0 || vault?.stored) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '8px 0', fontSize: '13px', color: '#16a34a' }}>
          <span>✓ Credentials remembered from last session{vault?.stored ? ' (secret saved on this Mac)' : ''}</span>
          <button
            onClick={clearSaved}
            style={{ fontSize: '12px', padding: '2px 8px', background: 'none', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', color: '#64748b' }}
          >Clear saved</button>
        </div>
      )}

      {/* Auth mode selector */}
      <div className="form-group">
        <label>How do you want to authenticate?</label>
        <div className="auth-mode-cards">
          {[
            { id: 'oneapi', icon: '🌐', label: 'OneAPI', sub: 'Zidentity API client — recommended' },
            ...(showLegacy ? [
              { id: 'apikey', icon: '🔑', label: 'API Key (legacy)', sub: 'Untested — may not work' },
              { id: 'oauth',  icon: '🔐', label: 'OAuth 2.0 (legacy)', sub: 'Untested — may not work' },
            ] : []),
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
        {!showLegacy && (
          <button onClick={() => setShowLegacy(true)} style={{ fontSize: 12, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '4px 0', textDecoration: 'underline' }}>
            Tenant not on Zidentity? Show legacy API Key / OAuth options
          </button>
        )}
        {showLegacy && authMode !== 'oneapi' && (
          <div className="alert alert-warning" style={{ marginTop: 8 }}><span>⚠️ The legacy modes haven’t been exercised end to end by this wizard. If your tenant uses Zidentity (most do now), use OneAPI.</span></div>
        )}
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
              placeholder={secretSaved('apiKey') ? '•••••••• saved on this Mac — paste a new one to replace it' : 'Paste your API key here'}
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
                placeholder={secretSaved('clientSecret') ? '•••••••• saved on this Mac — paste a new one to replace it' : (isOneApi ? 'Zidentity Client Secret' : 'OAuth Client Secret')}
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
        <div className="form-group">
          <label>ZPA Customer ID <span className="label-required">*</span></label>
          <input type="text" inputMode="numeric" placeholder="e.g. 216196257331281920" value={customerId}
            onChange={e => { setCustomerId(e.target.value.trim()); setError('') }} autoComplete="off" spellCheck={false} />
          <div className="hint">The numeric ZPA tenant ID (digits only) — <strong>not</strong> the Zidentity tenant UUID. Experience Center: <strong>Administration → Administration → Private Access Tenant</strong> → “ZPA tenant ID” (console.zscaler.com/private/company). Legacy ZPA Admin Portal: Configuration &amp; Control → Public API → API Keys. Asked once; later steps reuse it.</div>
          {customerId && !/^\d+$/.test(customerId) && <div className="hint" style={{ color: '#b45309' }}>Digits only — a value with letters or dashes is the Zidentity tenant ID, not the ZPA customer ID.</div>}
        </div>
      )}
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>Zscaler has no API for creating App Shield scans on any auth mode; the Scan step walks you through that one portal task. Everything else is automated.</div>

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
