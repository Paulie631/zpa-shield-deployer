import React, { useState, useEffect, useRef } from 'react'
import axios from 'axios'

const CS_STORAGE_KEY = 'zpa-cs-creds'
const PROJECT_ID     = 'PRotcbPOeZ9_Dd4lJww1o-6A2'
const BP_APP_SCANNER = 'BPps02yDq1W9eCQwn3xyjMgQ2'
const BP_NAME        = 'App Connector Base'
const REGION_MIAMI   = 'REKolD1-ab84YIxODeMGob9A2'
const POLICY_ID      = 'POEsi2O9SdO2D3GM-EZWuD6g2'

function loadCSCreds() {
  try { return JSON.parse(localStorage.getItem(CS_STORAGE_KEY) || '{}') } catch { return {} }
}
function saveCSCreds(obj) {
  try { localStorage.setItem(CS_STORAGE_KEY, JSON.stringify(obj)) } catch {}
}

const STATUS_COLOR = {
  'Ready': '#16a34a', 'Running': '#16a34a',
  'Suspended': '#d97706', 'Preparing': '#2563eb',
  'Creating': '#2563eb', 'Stopping': '#d97706', 'Loading from snapshot': '#2563eb',
}

const REGIONS = [
  { id: 'REKolD1-ab84YIxODeMGob9A2',  label: '🇺🇸 US East (Miami)' },
  { id: 'RE0YOUV7_lTmgb0X8D1UjM3g2',  label: '🇸🇬 Asia Pacific (Singapore)' },
  { id: 'RE6OEZs-y-mkK1mEMGwIgZiw2',  label: '🇳🇱 EU (Amsterdam)' },
]

// Rank VM templates for the test apps VM. Higher is better; below 0 means outdated.
// The test apps script supports apt (Ubuntu/Debian) and dnf (RHEL family).
export function rankTemplate(name = '') {
  const n = name.toLowerCase()
  if (/windows/.test(n)) return -100
  const ubuntu = n.match(/ubuntu[^0-9]*(\d{2})\.(\d{2})/)
  if (ubuntu) {
    const v = parseInt(ubuntu[1] + ubuntu[2], 10)        // 24.04 -> 2404
    const lts = ubuntu[2] === '04'
    if (v < 2004) return -10                            // 18.04 and older: out of support
    return lts ? 500 + (v - 2000) / 10 : 300 + (v - 2000) / 10   // LTS (24.04 -> 540) beats interim releases
  }
  if (/ubuntu/.test(n)) {
    if (/xenial|trusty|bionic|precise/.test(n)) return -10
    if (/noble/.test(n)) return 540
    if (/jammy/.test(n)) return 520
    if (/focal/.test(n)) return 500
    return 100                                          // Ubuntu, version unknown
  }
  const rhel = n.match(/(rocky|alma|rhel|red ?hat|centos stream|centos)[^0-9]*(\d+)/)
  if (rhel) {
    const v = parseInt(rhel[2], 10)
    if (v >= 9) return 520
    if (v === 8) return 480
    return -10                                          // CentOS 7 and older
  }
  const debian = n.match(/debian[^0-9]*(\d+)/)
  if (debian) {
    const v = parseInt(debian[1], 10)
    return v >= 12 ? 510 : v === 11 ? 470 : -10
  }
  if (/rocky|alma|rhel|red ?hat|debian|centos|fedora|linux/.test(n)) return 50
  return -50                                            // not obviously Linux
}

export default function CloudShareConfig({ data, update, next, back }) {
  const saved = loadCSCreds()

  const [apiId, setApiId]   = useState(data.csApiId || saved.apiId || '')
  const [apiKey, setApiKey] = useState(data.csApiKey || saved.apiKey || '')
  const [showKey, setShowKey] = useState(false)

  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [connected, setConnected] = useState(false)

  const [environments, setEnvironments] = useState([])
  const [selectedEnv, setSelectedEnv]   = useState(data.csEnvId || '')
  const [envDetail, setEnvDetail]       = useState(null)
  const [loadingEnv, setLoadingEnv]     = useState(false)
  const [selectedVm, setSelectedVm]     = useState(data.csVmId || '')

  // Second VM for the test apps (DVWA + Juice Shop)
  const [selectedTestVm, setSelectedTestVm] = useState(data.csTestVmId || '')
  const [showAddVm, setShowAddVm]       = useState(false)
  const [templates, setTemplates]       = useState(null)
  const [templateId, setTemplateId]     = useState('')
  const [templateFilter, setTemplateFilter] = useState('')
  const [addingVm, setAddingVm]         = useState(false)
  const [addVmStatus, setAddVmStatus]   = useState('')
  const addPollRef = useRef(null)

  // Create-new-env state
  const [showCreate, setShowCreate]     = useState(false)
  const [createRegion, setCreateRegion] = useState(REGION_MIAMI)
  const [creating, setCreating]         = useState(false)
  const [createStatus, setCreateStatus] = useState('')
  const pollRef = useRef(null)

  useEffect(() => {
    if (apiId || apiKey) saveCSCreds({ apiId, apiKey })
  }, [apiId, apiKey])

  useEffect(() => {
    if (apiId && apiKey && !connected) connect()
  }, [])

  // Cleanup poll on unmount
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); if (addPollRef.current) clearInterval(addPollRef.current) }, [])

  const connect = async () => {
    setLoading(true); setError('')
    try {
      const res = await axios.get('/api/cloudshare/validate', { params: { apiId, apiKey } })
      setEnvironments(res.data.environments || [])
      setConnected(true)
      if (res.data.environments?.length === 1) setSelectedEnv(res.data.environments[0].id)
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Connection failed')
    } finally { setLoading(false) }
  }

  // Load env detail when env selected
  useEffect(() => {
    if (!selectedEnv || !connected) return
    setLoadingEnv(true); setEnvDetail(null); setSelectedVm('')
    axios.get(`/api/cloudshare/envs/${selectedEnv}`, { params: { apiId, apiKey } })
      .then(r => {
        setEnvDetail(r.data)
        const linuxVm = r.data.vms?.find(v => /linux|rhel|centos|fedora/i.test(v.os || '') || /linux|rhel|el9|connector/i.test(v.name || ''))
        const scannerVm = linuxVm || (r.data.vms?.length === 1 ? r.data.vms[0] : null)
        if (scannerVm) setSelectedVm(scannerVm.id)
        // Test apps VM: keep a previous choice, otherwise pick the other VM if there is exactly one
        const others = (r.data.vms || []).filter(v => v.id !== scannerVm?.id)
        if (data.csTestVmId && others.some(v => v.id === data.csTestVmId)) setSelectedTestVm(data.csTestVmId)
        else setSelectedTestVm(others.length === 1 ? others[0].id : '')
      })
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoadingEnv(false))
  }, [selectedEnv, connected])

  // Create new environment from App Connector Base blueprint
  const createEnvironment = async () => {
    setCreating(true); setError(''); setCreateStatus('🚀 Creating environment from App Connector Base blueprint...')
    try {
      const res = await axios.post('/api/cloudshare/envs', {
        apiId, apiKey,
        projectId: PROJECT_ID,
        policyId:  POLICY_ID,
        blueprintId: BP_APP_SCANNER,
        regionId: createRegion,
        envName: 'ZPA App Scanner',
        description: 'RHEL 9 App Scanner — created by ZPA Shield Deployer',
      })

      const newEnvId = res.data.environmentId
      if (!newEnvId) throw new Error('No environmentId returned')

      setCreateStatus('⏳ Environment created — waiting for VM to become ready (usually 2–4 min)...')
      setShowCreate(false)

      // Reload environments list
      const envsRes = await axios.get('/api/cloudshare/validate', { params: { apiId, apiKey } })
      setEnvironments(envsRes.data.environments || [])
      setSelectedEnv(newEnvId)

      // Poll until Ready
      let attempts = 0
      pollRef.current = setInterval(async () => {
        attempts++
        try {
          const detail = await axios.get(`/api/cloudshare/envs/${newEnvId}`, { params: { apiId, apiKey } })
          const st = detail.data.statusText
          const vmSt = detail.data.vms?.[0]?.statusText || ''
          setCreateStatus(`⏳ Environment: ${st} | VM: ${vmSt} — please wait...`)

          if (st === 'Ready' && (vmSt === 'Running' || vmSt === 'Ready')) {
            clearInterval(pollRef.current)
            setCreateStatus('')
            setCreating(false)
            setEnvDetail(detail.data)
            const vm = detail.data.vms?.[0]
            if (vm) setSelectedVm(vm.id)
          } else if (attempts > 60) { // 5 min timeout
            clearInterval(pollRef.current)
            setCreateStatus('⚠️ VM is taking longer than expected — check CloudShare portal, then refresh this page.')
            setCreating(false)
          }
        } catch (e) { /* ignore poll errors */ }
      }, 5000)

    } catch (err) {
      setCreating(false)
      setCreateStatus('')
      setError(err.response?.data?.error || err.message || 'Failed to create environment')
    }
  }

  // ── Add a second VM (for test apps) from a CloudShare template ──
  const LINUX_RE = /ubuntu|debian|centos|rhel|red ?hat|rocky|alma|fedora|linux/i
  const loadTemplates = async () => {
    setShowAddVm(true); setError('')
    if (templates) return
    try {
      const r = await axios.get('/api/cloudshare/templates', { params: { apiId, apiKey, regionId: envDetail?.regionId } })
      // Best first: newest supported release, then more CPU/RAM, then name
      const list = (r.data || []).map(t => ({ ...t, rank: rankTemplate(t.name) }))
        .sort((a, b) => b.rank - a.rank
          || ((b.resources?.memorySizeMB || 0) - (a.resources?.memorySizeMB || 0))
          || a.name.localeCompare(b.name))
      setTemplates(list)
      if (list[0] && list[0].rank > 0) setTemplateId(list[0].id)
    } catch (e) { setError(e.response?.data?.error || e.message); setTemplates([]) }
  }

  const addTestVm = async () => {
    setAddingVm(true); setError(''); setAddVmStatus('🚀 Adding VM to the environment...')
    const before = new Set((envDetail?.vms || []).map(v => v.id))
    try {
      await axios.post(`/api/cloudshare/envs/${selectedEnv}/vms`, { apiId, apiKey, templateVmId: templateId, name: 'ZPA Test Apps' })
      setShowAddVm(false)
      let attempts = 0
      addPollRef.current = setInterval(async () => {
        attempts++
        try {
          const detail = await axios.get(`/api/cloudshare/envs/${selectedEnv}`, { params: { apiId, apiKey } })
          const added = (detail.data.vms || []).find(v => !before.has(v.id))
          setAddVmStatus(`⏳ Environment: ${detail.data.statusText} | New VM: ${added?.statusText || 'not listed yet'} — please wait...`)
          if (added && detail.data.statusText === 'Ready' && (added.statusText === 'Running' || added.statusText === 'Ready')) {
            clearInterval(addPollRef.current)
            setEnvDetail(detail.data); setSelectedTestVm(added.id)
            setAddVmStatus(''); setAddingVm(false)
          } else if (attempts > 75) { // ~10 min
            clearInterval(addPollRef.current)
            setEnvDetail(detail.data)
            setAddVmStatus('⚠️ The new VM is taking longer than expected — check the CloudShare portal, then pick it here once it is running.')
            setAddingVm(false)
          }
        } catch (e) { /* ignore poll errors */ }
      }, 8000)
    } catch (err) {
      setAddingVm(false); setAddVmStatus('')
      setError(err.response?.data?.error || err.message || 'Failed to add VM')
    }
  }

  const selectedVmDetail = envDetail?.vms?.find(v => v.id === selectedVm)
  const otherVms = (envDetail?.vms || []).filter(v => v.id !== selectedVm)
  const testVmDetail = otherVms.find(v => v.id === selectedTestVm)
  const shownTemplates = (templates || []).filter(t =>
    templateFilter ? t.name.toLowerCase().includes(templateFilter.toLowerCase()) : t.rank > -50)
  const bestRank = templates?.[0]?.rank ?? 0
  const chosenTemplate = (templates || []).find(t => t.id === templateId)
  const canContinue = connected && selectedEnv && selectedVm && selectedVmDetail && !creating && !addingVm

  const handleContinue = () => {
    update({
      csApiId: apiId,
      csApiKey: apiKey,
      csEnvId: selectedEnv,
      csEnvName: envDetail?.name,
      csVmId: selectedVm,
      csVmName: selectedVmDetail?.name,
      csHostname: selectedVmDetail?.externalAddress || selectedVmDetail?.internalAddresses?.[0] || '',
      csUser: /windows/i.test(selectedVmDetail?.os || '') ? 'administrator' : 'admin',
      csUsername: selectedVmDetail?.username,
      csPassword: selectedVmDetail?.password,
      csWebAccess: selectedVmDetail?.webAccessUrl,
      csTestVmId: testVmDetail?.id || '',
      csTestVmName: testVmDetail?.name || '',
      csTestVmIp: testVmDetail?.internalAddresses?.[0] || testVmDetail?.externalAddress || '',
    })
    next()
  }

  return (
    <div className="card">
      <h2>CloudShare Environment</h2>
      <p className="subtitle">
        Connect your CloudShare account to automatically discover or create your App Scanner VM.
      </p>

      {/* Not yet connected */}
      {!connected ? (
        <div>
          <div className="alert alert-info" style={{ marginBottom: '16px' }}>
            <strong>📋 How this works:</strong>
            <ol style={{ margin: '8px 0 0 0', paddingLeft: '20px', lineHeight: '1.8' }}>
              <li>Enter your CloudShare API credentials</li>
              <li>Pick an existing RHEL 9 VM <em>or</em> let the wizard create one automatically</li>
              <li>Pick or add a second VM for the test apps (DVWA + Juice Shop)</li>
              <li>The wizard then deploys the test apps, sets up ZPA, and installs the App Scanner</li>
            </ol>
            <div style={{ marginTop: '8px', fontSize: '13px', color: '#64748b' }}>
              💡 Find your API ID + Key at: <strong>use.cloudshare.com → Profile → API</strong>
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
            <div className="hint">Saved locally in your browser — never sent to any server except CloudShare.</div>
          </div>

          {error && <div className="alert alert-error">⚠️ {error}</div>}

          <div className="btn-row">
            <button className="btn btn-secondary" onClick={back}>← Back</button>
            <button className="btn btn-primary" onClick={connect} disabled={!apiId || !apiKey || loading}>
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

          {/* Create status / polling */}
          {createStatus && (
            <div className="alert alert-info" style={{ marginBottom: '16px' }}>
              {createStatus}
            </div>
          )}

          {/* Environment picker */}
          <div className="form-group">
            <label>Environment <span className="label-required">*</span></label>
            {environments.length === 0 ? (
              <div className="alert alert-warning">⚠️ No environments found.</div>
            ) : (
              <select value={selectedEnv} onChange={e => setSelectedEnv(e.target.value)} disabled={creating}>
                <option value="">— Select an environment —</option>
                {environments.map(env => (
                  <option key={env.id} value={env.id}>{env.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Create new env section */}
          {!creating && (
            <div style={{ marginBottom: '20px' }}>
              {!showCreate ? (
                <button
                  onClick={() => setShowCreate(true)}
                  style={{ fontSize: '13px', padding: '6px 14px', background: 'none', border: '1px solid #2563eb', borderRadius: '6px', cursor: 'pointer', color: '#2563eb' }}>
                  ➕ Create new RHEL 9 VM from <strong>{BP_NAME}</strong> blueprint
                </button>
              ) : (
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '16px', marginTop: '8px' }}>
                  <div style={{ fontWeight: 600, marginBottom: '12px' }}>🚀 Create new App Scanner environment</div>
                  <div style={{ fontSize: '13px', color: '#475569', marginBottom: '12px' }}>
                    Creates a new environment from the <strong>{BP_NAME}</strong> blueprint —
                    a RHEL 9 Linux VM pre-configured for Zscaler connectors.
                    Takes about 2–4 minutes.
                  </div>
                  <div className="form-group" style={{ marginBottom: '12px' }}>
                    <label style={{ fontSize: '13px' }}>Region</label>
                    <select value={createRegion} onChange={e => setCreateRegion(e.target.value)}>
                      {REGIONS.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn btn-primary" onClick={createEnvironment} style={{ fontSize: '13px' }}>
                      🚀 Create Environment
                    </button>
                    <button onClick={() => setShowCreate(false)}
                      style={{ fontSize: '13px', padding: '6px 14px', background: 'none', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer' }}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* VM picker */}
          {selectedEnv && (
            loadingEnv || creating ? (
              <div style={{ color: '#64748b', fontSize: '14px', margin: '12px 0' }}>
                {creating ? '⏳ Waiting for VM to become ready...' : '🔄 Loading environment details...'}
              </div>
            ) : envDetail ? (
              <>
                {/* Env status */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px', fontSize: '13px' }}>
                  <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                    <span><strong>Status:</strong> <span style={{ color: STATUS_COLOR[envDetail.statusText] || '#64748b' }}>● {envDetail.statusText}</span></span>
                    <span><strong>Project:</strong> {envDetail.projectName}</span>
                    <span><strong>Expires:</strong> {envDetail.expirationTime ? new Date(envDetail.expirationTime).toLocaleDateString() : '—'}</span>
                  </div>
                </div>

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
                            checked={selectedVm === vm.id} onChange={() => setSelectedVm(vm.id)}
                            style={{ marginTop: '2px', width: 'auto', flex: 'none' }} />
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

                {/* Connection details */}
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
                    {!/linux/i.test(selectedVmDetail.os || '') && (
                      <div className="alert alert-warning" style={{ marginTop: '10px' }}>
                        ⚠️ This VM appears to be <strong>{selectedVmDetail.os}</strong>. App Scanner requires <strong>RHEL 9</strong>.
                      </div>
                    )}
                  </div>
                )}

                {/* Second VM for the test apps */}
                {selectedVmDetail && (
                  <div className="form-group">
                    <label>VM for test apps (DVWA + Juice Shop)</label>
                    <div className="hint" style={{ marginBottom: '8px' }}>
                      A separate Linux VM in the same environment, so the App Scanner VM keeps its resources and its reboot doesn’t take the apps down. Optional — leave it unselected to set up test apps yourself.
                    </div>
                    {addVmStatus && <div className="alert alert-info" style={{ marginBottom: '10px' }}>{addVmStatus}</div>}
                    {otherVms.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '10px' }}>
                        {otherVms.map(vm => (
                          <label key={vm.id} style={{
                            display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '10px 14px',
                            border: `2px solid ${selectedTestVm === vm.id ? '#2563eb' : '#e2e8f0'}`,
                            borderRadius: '10px', cursor: 'pointer', background: selectedTestVm === vm.id ? '#eff6ff' : '#fff'
                          }}>
                            <input type="radio" name="testvm" value={vm.id}
                              checked={selectedTestVm === vm.id} onChange={() => setSelectedTestVm(vm.id)}
                              style={{ marginTop: '2px', width: 'auto', flex: 'none' }} />
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 600 }}>{vm.name}</div>
                              <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                                {vm.os} &nbsp;·&nbsp; {vm.cpuCount} vCPU &nbsp;·&nbsp; {Math.round(vm.memorySizeMb/1024)} GB RAM
                                {vm.internalAddresses?.[0] && <span> &nbsp;·&nbsp; IP: {vm.internalAddresses[0]}</span>}
                                <span style={{ marginLeft: '10px', color: STATUS_COLOR[vm.statusText] || '#64748b' }}>● {vm.statusText}</span>
                              </div>
                            </div>
                          </label>
                        ))}
                        {selectedTestVm && (
                          <button onClick={() => setSelectedTestVm('')}
                            style={{ alignSelf: 'flex-start', fontSize: '12px', padding: '2px 8px', background: 'none', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', color: '#64748b' }}>
                            Clear selection
                          </button>
                        )}
                      </div>
                    )}
                    {testVmDetail && !/linux|ubuntu|debian|centos|rhel|red hat|rocky|alma/i.test((testVmDetail.os || '') + ' ' + (testVmDetail.name || '')) && (
                      <div className="alert alert-warning" style={{ marginBottom: '10px' }}>
                        ⚠️ This VM appears to be <strong>{testVmDetail.os}</strong>. The test apps need a Linux VM (Ubuntu/Debian or RHEL-family).
                      </div>
                    )}
                    {!addingVm && !showAddVm && (
                      <button onClick={loadTemplates}
                        style={{ fontSize: '13px', padding: '6px 14px', background: 'none', border: '1px solid #2563eb', borderRadius: '6px', cursor: 'pointer', color: '#2563eb' }}>
                        ➕ Add a VM to this environment for test apps
                      </button>
                    )}
                    {showAddVm && (
                      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '16px' }}>
                        <div style={{ fontWeight: 600, marginBottom: '8px' }}>Add a Linux VM from a CloudShare template</div>
                        {templates === null ? (
                          <div style={{ fontSize: '13px', color: '#64748b' }}>🔄 Loading templates...</div>
                        ) : (
                          <>
                            <input type="text" placeholder="Filter templates by name (default shows Linux templates)"
                              value={templateFilter} onChange={e => setTemplateFilter(e.target.value)} style={{ marginBottom: '8px' }} />
                            <select value={templateId} onChange={e => setTemplateId(e.target.value)}>
                              <option value="">— Select a template ({shownTemplates.length} shown) —</option>
                              {shownTemplates.map(t => (
                                <option key={t.id} value={t.id}>
                                  {t.rank === bestRank && t.rank > 0 ? '★ ' : ''}{t.name}{t.resources ? ` — ${t.resources.cpuCount} vCPU, ${Math.round(t.resources.memorySizeMB/1024)} GB RAM` : ''}{t.rank < 0 ? ' (outdated)' : ''}
                                </option>
                              ))}
                            </select>
                            {chosenTemplate && chosenTemplate.rank > 0 && chosenTemplate.rank === bestRank && (
                              <div className="hint" style={{ color: '#16a34a' }}>★ Recommended — the newest supported Linux release available to you.</div>
                            )}
                            {chosenTemplate && chosenTemplate.rank < 0 && (
                              <div className="hint" style={{ color: '#dc2626' }}>This release is outdated and likely won’t install Docker cleanly. Pick a ★ template if you can.</div>
                            )}
                            {templates.length > 0 && bestRank <= 0 && (
                              <div className="hint" style={{ color: '#d97706' }}>No current Linux templates found (Ubuntu 20.04+, Debian 11+, Rocky/RHEL 8+). Type in the filter box to search all templates.</div>
                            )}
                            <div className="hint">The VM also needs internet access to download Docker and the app images. 2 vCPU and 4 GB RAM is enough for both apps.</div>
                          </>
                        )}
                        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                          <button className="btn btn-primary" onClick={addTestVm} disabled={!templateId} style={{ fontSize: '13px' }}>
                            ➕ Add VM
                          </button>
                          <button onClick={() => setShowAddVm(false)}
                            style={{ fontSize: '13px', padding: '6px 14px', background: 'none', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer' }}>
                            Cancel
                          </button>
                        </div>
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
              Continue →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
