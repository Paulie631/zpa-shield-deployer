import React, { useState, useEffect } from 'react'
import axios from 'axios'

const CS_STORAGE_KEY = 'zpa-sh-cs-creds'

function loadCSCreds() {
  try { return JSON.parse(localStorage.getItem(CS_STORAGE_KEY) || '{}') } catch { return {} }
}
function saveCSCreds(obj) {
  try { localStorage.setItem(CS_STORAGE_KEY, JSON.stringify(obj)) } catch {}
}

const STATUS_COLOR = {
  'Ready': '#16a34a',
  'Running': '#16a34a',
  'Suspended': '#d97706',
  'Preparing': '#2563eb',
  'Creating': '#2563eb',
  'Stopping': '#d97706',
}

export default function CloudShareConfig({ data, update, next, back }) {
  const saved = loadCSCreds()

  const [apiId, setApiId]   = useState(data.csApiId || saved.apiId || '')
  const [apiKey, setApiKey] = useState(data.csApiKey || saved.apiKey || '')
  const [showKey, setShowKey] = useState(false)

  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [connected, setConnected] = useState(false)

  const [environments, setEnvironments] = useState([])
  const [selectedEnv, setSelectedEnv]   = useState(data.csEnvId || '')
  const [envDetail, setEnvDetail]       = useState(null)
  const [loadingEnv, setLoadingEnv]     = useState(false)

  const [selectedVm, setSelectedVm] = useState(data.csVmId || '')

  // Persist creds
  useEffect(() => {
    if (apiId || apiKey) saveCSCreds({ apiId, apiKey })
  }, [apiId, apiKey])

  // Auto-connect if creds already saved
  useEffect(() => {
    if (apiId && apiKey && !connected) connect()
  }, [])

  const connect = async () => {
    setLoading(true); setError('')
    try {
      const res = await axios.get('/api/cloudshare/validate', { params: { apiId, apiKey } })
      setEnvironments(res.data.environments || [])
      setConnected(true)
      // Auto-select first env if only one
      if (res.data.environments?.length === 1) {
        setSelectedEnv(res.data.environments[0].id)
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Connection failed')
    } finally {
      setLoading(false)
    }
  }

  // Load env detail when env selected
  useEffect(() => {
    if (!selectedEnv || !connected) return
    setLoadingEnv(true); setEnvDetail(null); setSelectedVm('')
    axios.get(`/api/cloudshare/envs/${selectedEnv}`, { params: { apiId, apiKey } })
      .then(r => {
        setEnvDetail(r.data)
        // Auto-select first Linux/RHEL VM if present
        const linuxVm = r.data.vms?.find(v => /linux|rhel|centos|fedora/i.test(v.os || '') || /linux|rhel/i.test(v.name || ''))
        if (linuxVm) setSelectedVm(linuxVm.id)
        else if (r.data.vms?.length === 1) setSelectedVm(r.data.vms[0].id)
      })
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoadingEnv(false))
  }, [selectedEnv, connected])

  const selectedVmDetail = envDetail?.vms?.find(v => v.id === selectedVm)

  const canContinue = connected && selectedEnv && selectedVm && selectedVmDetail

  const handleContinue = () => {
    update({
      csApiId: apiId,
      csApiKey: apiKey,
      csEnvId: selectedEnv,
      csEnvName: envDetail?.name,
      csVmId: selectedVm,
      csVmName: selectedVmDetail?.name,
      csHostname: selectedVmDetail?.externalAddress || selectedVmDetail?.internalAddresses?.[0] || '',
      csUser: /windows/i.test(selectedVmDetail?.os || '') ? 'administrator' : 'ec2-user',
      csUsername: selectedVmDetail?.username,
      csPassword: selectedVmDetail?.password,
      csWebAccess: selectedVmDetail?.webAccessUrl,
    })
    next()
  }

  return (
    <div className="card">
      <h2>CloudShare Environment</h2>
      <p className="subtitle">
        Connect your CloudShare account to automatically discover your environments and VMs.
      </p>

      {/* Credentials */}
      {!connected ? (
        <div>
          <div className="alert alert-info" style={{ marginBottom: '16px' }}>
            <strong>📋 How this works:</strong>
            <ol style={{ margin: '8px 0 0 0', paddingLeft: '20px', lineHeight: '1.8' }}>
              <li>Enter your CloudShare API credentials below</li>
              <li>We'll fetch your environments and VMs automatically</li>
              <li>Select the VM to deploy the App Scanner on</li>
              <li>The next step generates a ready-to-run setup script</li>
            </ol>
            <div style={{ marginTop: '8px', fontSize: '13px', color: '#64748b' }}>
              💡 Find your API ID and Key at: <strong>use.cloudshare.com → Profile → API</strong>
            </div>
          </div>

          <div className="form-group">
            <label>API ID <span className="label-required">*</span></label>
            <input type="text" placeholder="e.g. JLUXXLF2XZM9CAKJ"
              value={apiId} onChange={e => setApiId(e.target.value.trim())} />
          </div>

          <div className="form-group">
            <label>API Key <span className="label-required">*</span></label>
            <div className="input-with-reveal">
              <input type={showKey ? 'text' : 'password'} placeholder="Your CloudShare API Key"
                value={apiKey} onChange={e => setApiKey(e.target.value.trim())} />
              <button className="reveal-btn" onClick={() => setShowKey(s => !s)}>
                {showKey ? '🙈 Hide' : '👁 Show'}
              </button>
            </div>
            <div className="hint">Credentials are saved locally in your browser only.</div>
          </div>

          {error && <div className="alert alert-error">⚠️ {error}</div>}

          <div className="btn-row">
            <button className="btn btn-secondary" onClick={back}>← Back</button>
            <button className="btn btn-primary" onClick={connect}
              disabled={!apiId || !apiKey || loading}>
              {loading ? '🔄 Connecting...' : '🔌 Connect to CloudShare →'}
            </button>
          </div>
        </div>
      ) : (
        <div>
          {/* Connected badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px' }}>
            <span style={{ color: '#16a34a', fontWeight: 600 }}>✓ Connected to CloudShare</span>
            <button onClick={() => { setConnected(false); setEnvDetail(null); setEnvironments([]) }}
              style={{ fontSize: '12px', padding: '2px 8px', background: 'none', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', color: '#64748b' }}>
              Switch account
            </button>
          </div>

          {/* Environment picker */}
          <div className="form-group">
            <label>Environment <span className="label-required">*</span></label>
            {environments.length === 0 ? (
              <div className="alert alert-warning">⚠️ No environments found in this account.</div>
            ) : (
              <select value={selectedEnv} onChange={e => setSelectedEnv(e.target.value)}>
                <option value="">— Select an environment —</option>
                {environments.map(env => (
                  <option key={env.id} value={env.id}>{env.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Env detail + VM picker */}
          {selectedEnv && (
            loadingEnv ? (
              <div style={{ color: '#64748b', fontSize: '14px', margin: '12px 0' }}>🔄 Loading environment details...</div>
            ) : envDetail ? (
              <>
                {/* Env status card */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px', fontSize: '13px' }}>
                  <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                    <span><strong>Status:</strong> <span style={{ color: STATUS_COLOR[envDetail.statusText] || '#64748b' }}>● {envDetail.statusText}</span></span>
                    <span><strong>Project:</strong> {envDetail.projectName}</span>
                    <span><strong>Expires:</strong> {envDetail.expirationTime ? new Date(envDetail.expirationTime).toLocaleDateString() : '—'}</span>
                  </div>
                </div>

                {/* VM picker */}
                <div className="form-group">
                  <label>VM to install App Scanner on <span className="label-required">*</span></label>
                  {!envDetail.vms?.length ? (
                    <div className="alert alert-warning">⚠️ No VMs found in this environment.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {envDetail.vms.map(vm => (
                        <label key={vm.id} style={{
                          display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 14px',
                          border: `2px solid ${selectedVm === vm.id ? '#2563eb' : '#e2e8f0'}`,
                          borderRadius: '10px', cursor: 'pointer', background: selectedVm === vm.id ? '#eff6ff' : '#fff'
                        }}>
                          <input type="radio" name="vm" value={vm.id}
                            checked={selectedVm === vm.id}
                            onChange={() => setSelectedVm(vm.id)}
                            style={{ marginTop: '2px' }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600 }}>{vm.name}</div>
                            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                              {vm.os} &nbsp;·&nbsp; {vm.cpuCount} vCPU &nbsp;·&nbsp; {Math.round(vm.memorySizeMb/1024)} GB RAM &nbsp;·&nbsp; {vm.diskSizeGb} GB disk
                            </div>
                            <div style={{ fontSize: '12px', marginTop: '4px' }}>
                              <span style={{ color: STATUS_COLOR[vm.statusText] || '#64748b' }}>● {vm.statusText}</span>
                              {vm.externalAddress && <span style={{ marginLeft: '12px', color: '#64748b' }}>IP: {vm.externalAddress}</span>}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {/* Selected VM connection details */}
                {selectedVmDetail && (
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px', fontSize: '13px' }}>
                    <div style={{ fontWeight: 600, marginBottom: '8px' }}>✅ VM Connection Details</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                      <div><strong>IP:</strong> {selectedVmDetail.externalAddress || selectedVmDetail.internalAddresses?.[0] || '—'}</div>
                      <div><strong>OS:</strong> {selectedVmDetail.os}</div>
                      <div><strong>Username:</strong> {selectedVmDetail.username}</div>
                      <div><strong>Password:</strong> {selectedVmDetail.password || '—'}</div>
                      {selectedVmDetail.webAccessUrl && (
                        <div style={{ gridColumn: '1/-1' }}>
                          <strong>Web Access:</strong>{' '}
                          <a href={selectedVmDetail.webAccessUrl.replace('[]','')} target="_blank" rel="noreferrer">
                            Open in browser ↗
                          </a>
                        </div>
                      )}
                    </div>
                    {!/linux|rhel/i.test(selectedVmDetail.os || '') && (
                      <div className="alert alert-warning" style={{ marginTop: '10px' }}>
                        ⚠️ This VM appears to be <strong>{selectedVmDetail.os}</strong>. App Scanner requires <strong>RHEL 9</strong>. Select a Linux VM or ensure this is RHEL-based.
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : null
          )}

          {error && <div className="alert alert-error">⚠️ {error}</div>}

          <div className="btn-row">
            <button className="btn btn-secondary" onClick={back}>← Back</button>
            <button className="btn btn-primary" onClick={handleContinue} disabled={!canContinue}>
              Generate Setup Script →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
