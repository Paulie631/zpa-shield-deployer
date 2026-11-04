import React, { useState, useEffect, useRef } from 'react'
import axios from 'axios'

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
  const pollRef = useRef(null)
  const isAWS = data.target === 'aws'

  const deploy = async () => {
    setDeploying(true)
    setError('')
    try {
      await axios.post('/api/aws/deploy-test-apps', {
        accessKeyId: data.accessKeyId,
        secretAccessKey: data.secretAccessKey,
        region: data.region,
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
        params: { stackName: 'zpa-test-apps', region: data.region, accessKeyId: data.accessKeyId, secretAccessKey: data.secretAccessKey }
      })
      setStackStatus(r.data.status)
      if (r.data.status === 'CREATE_COMPLETE') {
        clearInterval(pollRef.current)
        setDeploying(false)
        const ip = r.data.outputs?.find(o => o.OutputKey === 'PrivateIp')?.OutputValue
        setPrivateIp(ip || '')
        update({ testAppsLaunched: true, testAppsPrivateIp: ip, testApps: APPS })
      } else if (r.data.status.includes('FAILED') || r.data.status.includes('ROLLBACK')) {
        clearInterval(pollRef.current)
        setDeploying(false)
      }
    } catch (e) {}
  }

  useEffect(() => () => clearInterval(pollRef.current), [])

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
          <div key={app.name} className={`app-card ${launched && stackStatus === 'CREATE_COMPLETE' ? 'deployed' : ''}`}
            style={{ background: launched && stackStatus === 'CREATE_COMPLETE' ? undefined : app.color }}>
            <div className="app-icon">{app.icon}</div>
            <h4>{app.name}</h4>
            <p>{app.desc}</p>
            <div className="port">Port {app.port} · {app.domain}</div>
            {launched && stackStatus === 'CREATE_COMPLETE' && (
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

      {!isAWS && (
        <div className="alert alert-warning">
          ⚠️ For CloudShare: run these commands on a second VM after your App Scanner is set up:
          <pre style={{ marginTop: 8, background: '#1e293b', color: '#e2e8f0', padding: '10px', borderRadius: '6px', fontSize: '12px' }}>
{`sudo dnf install -y docker
sudo systemctl start docker && sudo systemctl enable docker
sudo docker run -d --name dvwa -p 80:80 vulnerables/web-dvwa
sudo docker run -d --name juiceshop -p 3000:3000 bkimminich/juice-shop`}
          </pre>
        </div>
      )}

      {error && <div className="alert alert-error">⚠️ {error}</div>}

      {launched && stackStatus && (
        <div className="stack-status" style={{ marginTop: 16 }}>
          <h4>Test Apps Stack</h4>
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
          ✅ <strong>Next:</strong> In ZPA Admin Portal, create two app segments pointing to <strong>{privateIp}</strong> — one for DVWA (port 80) and one for Juice Shop (port 3000). Then select them in the scan config.
        </div>
      )}

      <div className="btn-row">
        <button className="btn btn-secondary" onClick={back} disabled={deploying}>← Back</button>
        {isAWS && !launched && (
          <button className="btn btn-secondary" onClick={handleSkip}>Skip — I'll set up apps manually</button>
        )}
        {isAWS && !launched && (
          <button className="btn btn-primary" onClick={deploy} disabled={deploying}>
            {deploying ? <><span className="spinner" /> Deploying...</> : '🚀 Deploy Test Apps'}
          </button>
        )}
        {(!isAWS || (launched && stackStatus === 'CREATE_COMPLETE')) && (
          <button className="btn btn-primary" onClick={next}>Continue →</button>
        )}
        {isAWS && launched && stackStatus !== 'CREATE_COMPLETE' && !stackStatus.includes('FAILED') && (
          <button className="btn btn-primary" disabled>Waiting for stack...</button>
        )}
        {isAWS && launched && stackStatus.includes('FAILED') && (
          <button className="btn btn-secondary" onClick={next}>Skip & Continue →</button>
        )}
      </div>
    </div>
  )
}
