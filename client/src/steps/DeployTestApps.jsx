import React, { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { awsAuth } from '../lib/aws'

const APPS = [
  { name: 'DVWA', icon: '🎯', port: 80, domain: 'dvwa.internal', desc: 'Damn Vulnerable Web App — SQLi, XSS, CSRF, File Inclusion, Command Injection, Path Traversal', color: '#FEE2E2' },
  { name: 'Juice Shop', icon: '🥤', port: 3000, domain: 'juiceshop.internal', desc: 'OWASP Juice Shop — 100+ intentional vulns across OWASP Top 10. Looks like a real e-commerce app.', color: '#FEF3C7' }
]

export default function DeployTestApps({ data, update, next, back }) {
  const [deploying, setDeploying] = useState(false)
  const [stackStatus, setStackStatus] = useState('')
  const [privateIp, setPrivateIp] = useState('')
  const [error, setError] = useState('')
  const [launched, setLaunched] = useState(data.testAppsLaunched || false)
  const [skipped, setSkipped] = useState(false)
  const [failures, setFailures] = useState([])
  const stackDead = /ROLLBACK_COMPLETE|_FAILED$/.test(stackStatus)
  const pollRef = useRef(null)
  const isAWS = data.target === 'aws'

  // CloudShare: deploy onto the second VM through the CloudShare API
  const canRunRemote = !isAWS && data.csTestVmId && data.csApiId && data.csApiKey
  const [runState, setRunState] = useState(data.testAppsLaunched && !isAWS ? 'done' : 'idle') // idle | starting | running | done | failed
  const [runLog, setRunLog]     = useState('')
  const [runError, setRunError] = useState('')
  const logPollRef = useRef(null)
  const failCountRef = useRef(0)
  const vmUrl = `/api/cloudshare/vms/${encodeURIComponent(data.csTestVmId || '')}`

  const pollLog = async () => {
    try {
      const r = await axios.get(`${vmUrl}/setup-log`, { params: { apiId: data.csApiId, apiKey: data.csApiKey, job: 'zpa-testapps' } })
      failCountRef.current = 0
      const log = r.data.log || ''
      if (log) setRunLog(log)
      if (r.data.done) {
        clearInterval(logPollRef.current)
        // Prefer the address CloudShare reports; fall back to the first one the VM printed
        const printed = (log.match(/VM_IPS:\s*(\S+)/) || [])[1]
        const ip = data.csTestVmIp || printed || ''
        setPrivateIp(ip)
        setRunState('done')
        update({ testAppsLaunched: true, testAppsPrivateIp: ip, testApps: APPS })
      } else if (r.data.failed) {
        clearInterval(logPollRef.current)
        setRunState('failed')
        setRunError(/NO INTERNET/.test(log)
          ? 'The test apps VM has no internet access, so it cannot download Docker or the app images. Check the VM\'s network/internet settings in CloudShare (or use a different template), then try again.'
          : 'The script stopped with an error — see the log below.')
      }
    } catch (e) {
      failCountRef.current += 1
      if (failCountRef.current >= 6) {
        clearInterval(logPollRef.current)
        setRunState('failed')
        setRunError('Lost contact with the VM: ' + (e.response?.data?.error || e.message))
      }
    }
  }

  const deployOnVm = async () => {
    setRunState('starting'); setRunError(''); setRunLog(''); failCountRef.current = 0
    try {
      await axios.post(`${vmUrl}/run-testapps`, { apiId: data.csApiId, apiKey: data.csApiKey }, { timeout: 300000 })
      setRunState('running')
      logPollRef.current = setInterval(pollLog, 10000)
      pollLog()
    } catch (err) {
      setRunState('failed')
      setRunError(err.response?.data?.error || err.message)
    }
  }

  useEffect(() => () => clearInterval(logPollRef.current), [])
  const appsUp = (launched && stackStatus === 'CREATE_COMPLETE') || runState === 'done'

  const deploy = async () => {
    setDeploying(true)
    setError('')
    setFailures([])
    try {
      await axios.post('/api/aws/deploy-test-apps', {
        ...awsAuth(data),
        vpcId: data.vpcId,
        subnetId: data.subnetId,
        keyPairName: data.keyPairName,
        instanceType: 't3.medium',
        stackName: 'zpa-test-apps'
      })
      setLaunched(true)
      setStackStatus('CREATE_IN_PROGRESS')
      pollRef.current = setInterval(pollStatus, 5000)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
      setDeploying(false)
    }
  }

  const pollStatus = async () => {
    try {
      const r = await axios.get('/api/aws/stack-status', {
        params: { ...awsAuth(data), stackName: 'zpa-test-apps' }
      })
      setStackStatus(r.data.status)
      setFailures(r.data.failures || [])
      if (r.data.status === 'CREATE_COMPLETE') {
        clearInterval(pollRef.current)
        setDeploying(false)
        const ip = r.data.outputs?.find(o => o.OutputKey === 'PrivateIp')?.OutputValue
        setPrivateIp(ip || '')
        update({ testAppsLaunched: true, testAppsPrivateIp: ip, testApps: APPS })
      } else if (/_COMPLETE$|_FAILED$/.test(r.data.status)) {   // final failure state (keep polling through *_IN_PROGRESS)
        clearInterval(pollRef.current)
        setDeploying(false)
      }
      return r.data.status
    } catch (e) { return null }
  }

  useEffect(() => () => clearInterval(pollRef.current), [])

  // If this stack was already launched (e.g. before the page was refreshed), pick it up
  useEffect(() => {
    if (data.target !== 'aws' || !(data.accessKeyId || data.awsProfile)) return
    pollStatus().then(found => {
      if (!found) return
      setLaunched(true)
      if (!/_COMPLETE$|_FAILED$/.test(found)) {
        setDeploying(true)
        pollRef.current = setInterval(pollStatus, 5000)
      }
    })
  }, [])

  const handleSkip = () => {
    setSkipped(true)
    next()
  }

  const statusClass = stackStatus === 'CREATE_COMPLETE' ? 'complete'
    : stackStatus.includes('FAILED') || stackStatus.includes('ROLLBACK') ? 'failed' : 'in-progress'

  return (
    <div className="card">
      <h2>🧪 Deploy Test Applications</h2>
      <p className="subtitle">
        Deploy intentionally vulnerable apps to give the App Scanner something interesting to find. DVWA and OWASP Juice Shop cover the full OWASP Top 10 — perfect for demonstrating Shield in action.
      </p>

      <div className="app-cards">
        {APPS.map(app => (
          <div key={app.name} className={`app-card ${appsUp ? 'deployed' : ''}`}
            style={{ background: appsUp ? undefined : app.color }}>
            <div className="app-icon">{app.icon}</div>
            <h4>{app.name}</h4>
            <p>{app.desc}</p>
            <div className="port">Port {app.port} · {app.domain}</div>
            {appsUp && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#065f46', fontWeight: 600 }}>✅ Deployed</div>
            )}
          </div>
        ))}
      </div>

      {isAWS && (
        <div className="alert alert-info" style={{ marginTop: 4 }}>
          ℹ️ Deploys a <strong>t3.medium</strong> EC2 instance running RHEL 9 with Docker. DVWA and Juice Shop start automatically. The instance uses no inbound security group rules — ZPA handles access.
        </div>
      )}

      {canRunRemote && (
        <div style={{ marginTop: 4, marginBottom: 12, padding: 14, border: '1px solid #bfdbfe', borderRadius: 8, background: '#eff6ff' }}>
          <strong>Deploy on {data.csTestVmName || 'the test apps VM'}</strong>
          <div style={{ fontSize: 13, color: '#475569', margin: '4px 0 10px' }}>
            Installs Docker on the VM through the CloudShare API and starts DVWA (port 80) and Juice Shop (port 3000). Takes a few minutes while the images download.
          </div>
          {data.csTestVmNetOk === false && runState === 'idle' && (
            <div className="alert alert-error" style={{ marginBottom: 10 }}>
              <span>❌ The network check showed <strong>{data.csTestVmName}</strong> has no internet access, so it can’t download Docker or the apps. Go back, delete that VM in CloudShare and add one from a different template.</span>
            </div>
          )}
          {(runState === 'idle' || runState === 'failed') && (
            <button className="btn btn-primary" onClick={deployOnVm} disabled={data.csTestVmNetOk === false && runState === 'idle'}>
              {runState === 'failed' ? '↻ Try again' : '🚀 Deploy Test Apps'}
            </button>
          )}
          {runState === 'starting' && <div><span className="spinner spinner-blue" /> Uploading script and starting it (about a minute)...</div>}
          {runState === 'running' && <div><span className="spinner spinner-blue" /> Installing on the VM — log refreshes every 10 seconds</div>}
          {runState === 'done' && <div className="alert alert-success" style={{ margin: 0 }}><span>✅ Test apps are running{privateIp ? <> at <strong>{privateIp}</strong></> : ''}.</span></div>}
          {runError && <div className="alert alert-error" style={{ marginTop: 10 }}>⚠️ {runError}</div>}
          {runLog && (
            <pre style={{ marginTop: 10, maxHeight: 260, overflow: 'auto', background: '#0f172a', color: '#e2e8f0', padding: 10, borderRadius: 6, fontSize: 12, whiteSpace: 'pre-wrap' }}>{runLog}</pre>
          )}
        </div>
      )}

      {!isAWS && runState !== 'done' && (
        <div className="alert alert-warning">
          ⚠️ {canRunRemote ? 'To do it by hand instead, run these on the test apps VM (RHEL-family shown):' : 'No test apps VM was selected. To set them up yourself, run these on a second Linux VM (RHEL-family shown), or go back and pick a VM:'}
          <pre style={{ marginTop: 8, background: '#1e293b', color: '#e2e8f0', padding: '10px', borderRadius: '6px', fontSize: '12px' }}>
{`sudo dnf install -y yum-utils
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install -y docker-ce docker-ce-cli containerd.io
sudo systemctl enable --now docker
sudo docker run -d --restart unless-stopped --name dvwa -p 80:80 vulnerables/web-dvwa
sudo docker run -d --restart unless-stopped --name juiceshop -p 3000:3000 bkimminich/juice-shop`}
          </pre>
        </div>
      )}

      {error && <div className="alert alert-error">⚠️ {error}</div>}

      {launched && stackStatus && (
        <div className="stack-status" style={{ marginTop: 16 }}>
          <h4>Test Apps Stack</h4>
          {failures.length > 0 && (
            <div className="alert alert-error" style={{ display: 'block', margin: '8px 0' }}>
              <strong>Why AWS rolled it back:</strong>
              {failures.map((f, i) => <div key={i} style={{ marginTop: 4, fontSize: 13 }}>• <code>{f.resource}</code> ({f.type}): {f.reason}</div>)}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            {deploying && <span className="spinner spinner-blue" />}
            <span className={`status-label ${statusClass}`}>
              <span className={`status-dot ${statusClass === 'complete' ? 'success' : statusClass === 'failed' ? 'error' : 'running'}`} />
              {stackStatus}
            </span>
          </div>
          {privateIp && <div style={{ fontSize: 13 }}><strong>Private IP:</strong> {privateIp} — add this to your ZPA app segments</div>}
        </div>
      )}

      {privateIp && (
        <div className="alert alert-success" style={{ marginTop: 12 }}>
          <span>✅ <strong>Test apps at {privateIp}.</strong> The Configure Scan step can create their ZPA app segments for you (DVWA on port 80, Juice Shop on port 3000).</span>
        </div>
      )}

      <div className="btn-row">
        <button className="btn btn-secondary" onClick={back} disabled={deploying || runState === 'starting' || runState === 'running'}>← Back</button>
        {isAWS && !launched && (
          <button className="btn btn-secondary" onClick={handleSkip}>Skip — I'll set up apps manually</button>
        )}
        {isAWS && !launched && (
          <button className="btn btn-primary" onClick={deploy} disabled={deploying}>
            {deploying ? <><span className="spinner" /> Deploying...</> : '🚀 Deploy Test Apps'}
          </button>
        )}
        {(!isAWS || (launched && stackStatus === 'CREATE_COMPLETE')) && (
          <button className="btn btn-primary" onClick={next} disabled={runState === 'starting' || runState === 'running'}>
            {runState === 'starting' || runState === 'running' ? 'Waiting for test apps...' : runState === 'done' || isAWS ? 'Continue →' : 'Skip / Continue →'}
          </button>
        )}
        {isAWS && launched && stackStatus !== 'CREATE_COMPLETE' && !stackDead && (
          <button className="btn btn-primary" disabled>{/ROLLBACK/.test(stackStatus) ? 'Rolling back...' : 'Waiting for stack...'}</button>
        )}
        {isAWS && launched && stackDead && !deploying && (
          <>
            <button className="btn btn-secondary" onClick={next}>Skip & Continue →</button>
            <button className="btn btn-primary" onClick={deploy}>↻ Delete failed stack &amp; try again</button>
          </>
        )}
      </div>
    </div>
  )
}
