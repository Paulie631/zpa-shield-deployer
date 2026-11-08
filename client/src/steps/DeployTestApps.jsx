import React, { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import { awsAuth } from '../lib/aws'

import { TEST_APPS, PORT_LIST } from '../lib/testApps'
import { ElapsedBar, usePoll, dot, fmt } from '../components/WaitStatus'

const APPS = [
  { name: 'DVWA', icon: '🎯', port: 80, extra: '+ TLS on 443', desc: 'Damn Vulnerable Web App on a dated Apache/PHP stack — SQLi, XSS, CSRF, file inclusion, command injection.', color: '#FEE2E2' },
  { name: 'Juice Shop', icon: '🥤', port: 3000, extra: '+ HTTP on 8080, TLS on 8443', desc: 'OWASP Juice Shop (2022 build) — 100+ intentional flaws across the OWASP Top 10, in a realistic e-commerce app.', color: '#FEF3C7' },
  { name: 'WebGoat', icon: '🐐', port: 8081, extra: '', desc: 'OWASP WebGoat — a Java/Spring stack with its own set of lessons and known CVEs, for a third server fingerprint.', color: '#E0F2FE' },
  { name: 'Apache httpd 2.4.49', icon: '🪶', port: 8082, extra: '', desc: 'The 2021 path-traversal release. App Shield already runs this exact check — here it becomes a confirmed critical with a Block control.', color: '#FCE7F3' },
  { name: 'Tomcat 8.5', icon: '🐱', port: 8083, extra: '', desc: 'An early 8.5 build: a Java server fingerprint with a long version-CVE list and the manager app the scanner recognises.', color: '#FEF9C3' },
  { name: 'WordPress 4.9', icon: '📰', port: 8084, extra: '', desc: 'The most common real-world app, on old PHP — dozens of version CVEs and the largest Nuclei template family. Installer completes automatically.', color: '#DCFCE7' },
]

export default function DeployTestApps({ data, update, next, back }) {
  const [deploying, setDeploying] = useState(false)
  const [rerun, setRerun] = useState(null)
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
  const canRunRemote = !isAWS && data.csTestVmId && data.csApiId
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
      const r = await axios.post('/api/aws/deploy-test-apps', {
        ...awsAuth(data),
        vpcId: data.vpcId,
        subnetId: data.subnetId,
        keyPairName: data.keyPairName,
        instanceType: 't3.large',
        stackName: 'zpa-test-apps'
      })
      setRerun(r.data.rerun || null)
      update({ testAppsLaunchedAt: r.data.reused ? (data.testAppsLaunchedAt || new Date().toISOString()) : new Date().toISOString() })
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
        Deploy intentionally vulnerable apps to give the App Scanner something to find. Three OWASP training apps plus three old mainstream servers (Apache httpd, Tomcat, WordPress), with a TLS front door and a standard-port alias for Juice Shop, so App Shield's port fingerprinting, TLS checks, version-CVE matching and exploit confirmation all have material to work with — nine endpoints, nine ZPA segments.
      </p>

      <div className="app-cards">
        {APPS.map(app => (
          <div key={app.name} className={`app-card ${appsUp ? 'deployed' : ''}`}
            style={{ background: appsUp ? undefined : app.color }}>
            <div className="app-icon">{app.icon}</div>
            <h4>{app.name}</h4>
            <p>{app.desc}</p>
            <div className="port">Port {app.port}{app.extra ? ` ${app.extra}` : ''}{privateIp ? ` · http://${privateIp}${app.port === 80 ? '' : ':' + app.port}` : ''}</div>
            {appsUp && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#065f46', fontWeight: 600 }}>✅ Deployed</div>
            )}
          </div>
        ))}
      </div>

      {isAWS && (
        <div className="alert alert-info" style={{ marginTop: 4 }}>
          ℹ️ Deploys a <strong>t3.large</strong> EC2 instance running RHEL 9 with Docker. DVWA, Juice Shop, WebGoat, Apache httpd 2.4.49, Tomcat 8.5, WordPress 4.9 (with MySQL) and an nginx TLS front door start automatically. Inbound is limited to the test-app ports from inside the VPC (for the traffic connector and the scanner) — users reach it only through ZPA.
        </div>
      )}

      {canRunRemote && (
        <div style={{ marginTop: 4, marginBottom: 12, padding: 14, border: '1px solid #bfdbfe', borderRadius: 8, background: '#eff6ff' }}>
          <strong>Deploy on {data.csTestVmName || 'the test apps VM'}</strong>
          <div style={{ fontSize: 13, color: '#475569', margin: '4px 0 10px' }}>
            Installs Docker on the VM through the CloudShare API and starts DVWA, Juice Shop, WebGoat, Apache httpd 2.4.49, Tomcat 8.5, WordPress 4.9 and the nginx TLS front door (ports {PORT_LIST}). The VM needs about 8 GB RAM. Takes a few minutes while the images download.
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
          {privateIp && <div style={{ fontSize: 13 }}><strong>Private IP:</strong> {privateIp} — the Publish step creates the ZPA app segments for it</div>}
        </div>
      )}

      {rerun && (
        <div className={`alert ${rerun.needsRecreate ? 'alert-warning' : 'alert-info'}`} style={{ marginTop: 12, display: 'block' }}>
          {rerun.needsRecreate ? '⚠️ ' : 'ℹ️ '}{rerun.message}
        </div>
      )}

      {privateIp && isAWS && <EndpointReadiness data={data} ip={privateIp} update={update} />}

      {privateIp && (
        <div className="alert alert-success" style={{ marginTop: 12 }}>
          <span>✅ <strong>Test apps at {privateIp}.</strong> Next, Publish puts all nine endpoints behind ZPA (ports {PORT_LIST}).</span>
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

// Which of the test endpoints answer, probed from inside the VPC (the App Scanner or the test-apps
// VM, over Systems Manager). Doesn't block Continue; polls every 30s until all answer.
function EndpointReadiness({ data, ip, update }) {
  const startedAt = data.testAppsLaunchedAt
  const poll = usePoll(
    async () => (await axios.post('/api/aws/probe-test-apps', { ...awsAuth(data), ip, launchedAt: startedAt, notify: true })).data,
    { every: 30000, until: r => r.ok && r.allUp, enabled: !!ip, notifyText: r => `All ${r.endpoints.length} test endpoints are up at ${ip}`, deps: [ip] }
  )
  const r = poll.result
  const est = r?.estimate || { typical: 420, max: 720 }
  const [rr, setRr] = useState({ busy: false, msg: null, err: null })
  const rerunScript = async () => {
    setRr({ busy: true, msg: null, err: null })
    try {
      const out = (await axios.post('/api/aws/rerun-test-apps', { ...awsAuth(data) })).data
      setRr({ busy: false, msg: `Re-running the apps script on ${out.instanceId}. Containers usually answer within 1–3 minutes (images already on the VM). Log on the VM: ${out.log}`, err: null })
      update?.({ testAppsLaunchedAt: new Date().toISOString() })
      setTimeout(poll.refresh, 20000)
    } catch (e) { setRr({ busy: false, msg: null, err: e.response?.data?.error || e.message }) }
  }
  const showRerun = r?.ok && !r.allUp
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Endpoint readiness {r?.probedFrom ? <span className="hint">(probed from the {r.probedFrom})</span> : null}</strong>
        <button onClick={poll.refresh} disabled={poll.status === 'running'} style={{ fontSize: 12 }}>{poll.status === 'running' || poll.status === 'refreshing' ? <span className="spinner spinner-blue" /> : '↻ Check now'}</button>
      </div>
      <ElapsedBar startedAt={startedAt} estimate={est} done={!!r?.allUp} label={r?.allUp ? 'All endpoints answering' : 'Waiting for the apps to start'} />
      {poll.error && <div className="alert alert-error" style={{ marginTop: 6 }}><span>⚠️ {poll.error}</span></div>}
      {r && !r.ok && <div className="alert alert-warning" style={{ marginTop: 6, display: 'block' }}>🟡 {r.message}</div>}
      {r?.endpoints && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '4px 12px', marginTop: 8, fontSize: 13 }}>
          {r.endpoints.map(e => <div key={e.key}>{dot(e.ok)} <code>{e.url}</code> <span className="hint">{e.ok ? `HTTP ${e.code}` : e.code === '000' ? 'not answering yet' : e.code == null ? 'not probed' : `HTTP ${e.code}`}</span></div>)}
        </div>
      )}
      {r?.docker && <div className="hint" style={{ marginTop: 6 }}>Containers: {r.docker.split(';').filter(Boolean).join(' · ')}{r.mem ? ` · memory ${r.mem} MB` : ''}</div>}
      {r?.ok && !r.allUp && r.scriptPhase && <div className="hint" style={{ marginTop: 4 }}>Apps script on the VM: <strong>{r.scriptPhase}</strong>{!r.docker ? ' — no containers created yet' : ''}</div>}
      {r?.ok && !r.scriptPhase && !r.docker && r.probedFrom === 'test apps VM' && <div className="hint" style={{ marginTop: 4 }}>The apps script hasn’t written anything yet — on first boot it starts about a minute after the instance is reachable. If this persists past {fmt(est.typical)}, open Session Manager on the instance and run <code>sudo tail -n 40 /var/log/cloud-init-output.log</code>.</div>}
      {r?.warnings?.length > 0 && !r.allUp && (
        <div className="alert alert-warning" style={{ marginTop: 6, display: 'block' }}>
          <strong>The apps script reported problems on the VM:</strong>
          <ul style={{ margin: '4px 0 4px 18px' }}>{r.warnings.map((w, i) => <li key={i}><code style={{ fontSize: 12 }}>{w}</code></li>)}</ul>
          {r.warnings.some(w => /SCRIPT FAILED/.test(w)) && <div>An older version of the script stopped at the first error, so every app after that line never started. Click <strong>Deploy Test Apps</strong> again — the current script re-runs on this instance, tries fallback images and keeps going past a failed container.</div>}
          {r.warnings.some(w => /did not start/.test(w)) && !r.warnings.some(w => /SCRIPT FAILED/.test(w)) && <div>Those apps are skipped; everything else runs. Their segments will simply have nothing to scan — you can delete them on the Scan step, or check the image tags in <code>server/lib/testApps.js</code>.</div>}
        </div>
      )}
      {r && r.ok && !r.allUp && r.coreUp && !(r.warnings?.length > 0) && <div className="hint" style={{ marginTop: 6 }}>DVWA and Juice Shop are up — enough to continue to Publish. Tomcat and WordPress are usually the last to answer (allow up to {fmt(est.max)} after launch); if an endpoint is still red after that, the container probably failed: EC2 → the instance → Connect → Session Manager → <code>sudo docker ps -a</code>.</div>}
      {showRerun && (
        <div style={{ marginTop: 8 }}>
          <button onClick={rerunScript} disabled={rr.busy} style={{ fontSize: 13 }}>{rr.busy ? <span className="spinner spinner-blue" /> : '⟳ Re-run apps script on this instance'}</button>
          <span className="hint" style={{ marginLeft: 8 }}>Safe to repeat: stops any earlier run, recreates the containers, keeps the IP (no need to redo Publish).</span>
          {rr.msg && <div className="alert alert-info" style={{ marginTop: 6, display: 'block' }}>ℹ️ {rr.msg}</div>}
          {rr.err && <div className="alert alert-error" style={{ marginTop: 6 }}><span>⚠️ {rr.err}</span></div>}
        </div>
      )}
      {r && r.ok && r.allUp && <div className="hint" style={{ marginTop: 6 }}>✅ All {r.endpoints.length} endpoints answer from inside the VPC — the scanner can reach every one.</div>}
    </div>
  )
}

