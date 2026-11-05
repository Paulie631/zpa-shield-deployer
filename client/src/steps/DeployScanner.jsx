import React, { useState, useEffect, useRef } from 'react'
import axios from 'axios'
import CodePreview from '../components/CodePreview'

export default function DeployScanner({ data, update, next, back, isCloudShare }) {
  const [script, setScript] = useState('')
  const [scriptLoading, setScriptLoading] = useState(false)
  const [deploying, setDeploying] = useState(false)
  const [stackStatus, setStackStatus] = useState('')
  const [stackOutputs, setStackOutputs] = useState([])
  const [error, setError] = useState('')
  const [launched, setLaunched] = useState(false)
  const pollRef = useRef(null)

  // CloudShare: run the script on the VM through the CloudShare API
  const canRunRemote = isCloudShare && data.csVmId && data.csApiId && data.csApiKey
  const [runState, setRunState] = useState('idle') // idle | starting | running | done | failed
  const [runLog, setRunLog]     = useState('')
  const [runError, setRunError] = useState('')
  const logPollRef = useRef(null)
  const sawDoneRef = useRef(false)
  const failCountRef = useRef(0)

  const pollSetupLog = async () => {
    try {
      const r = await axios.get(`/api/cloudshare/vms/${encodeURIComponent(data.csVmId)}/setup-log`, {
        params: { apiId: data.csApiId, apiKey: data.csApiKey }
      })
      failCountRef.current = 0
      if (r.data.log) setRunLog(r.data.log)
      if (r.data.done) {
        sawDoneRef.current = true
        clearInterval(logPollRef.current)
        setRunState('done')
        update({ scannerSetupRan: true })
      }
    } catch (e) {
      // The script reboots the VM at the end, so lost contact after "Setup complete!" is success
      failCountRef.current += 1
      if (sawDoneRef.current) { clearInterval(logPollRef.current); setRunState('done') }
      else if (failCountRef.current >= 6) {
        clearInterval(logPollRef.current)
        setRunState('failed')
        setRunError('Lost contact with the VM before the script reported completion: ' + (e.response?.data?.error || e.message) +
          '. It may still be running or rebooting — check /tmp/zpa-setup.log on the VM.')
      }
    }
  }

  const runOnVm = async () => {
    setRunState('starting'); setRunError(''); setRunLog('')
    sawDoneRef.current = false; failCountRef.current = 0
    try {
      await axios.post(`/api/cloudshare/vms/${encodeURIComponent(data.csVmId)}/run-setup`, {
        apiId: data.csApiId, apiKey: data.csApiKey,
        provisioningKey: data.provisioningKey, ssmParamName: data.ssmParamName, region: data.region
      }, { timeout: 300000 })
      setRunState('running')
      logPollRef.current = setInterval(pollSetupLog, 10000)
      pollSetupLog()
    } catch (err) {
      setRunState('failed')
      setRunError(err.response?.data?.error || err.message)
    }
  }

  useEffect(() => () => clearInterval(logPollRef.current), [])

  // CloudShare: generate script on mount
  useEffect(() => {
    if (isCloudShare) {
      setScriptLoading(true)
      axios.post('/api/cloudshare/script', {
        ssmParamName: data.ssmParamName,
        provisioningKey: data.provisioningKey,
        region: data.region
      }).then(r => { setScript(r.data.script); setScriptLoading(false) })
        .catch(e => { setError(e.response?.data?.error || e.message); setScriptLoading(false) })
    }
  }, [])

  const launchStack = async () => {
    setDeploying(true)
    setError('')
    try {
      await axios.post('/api/aws/deploy', {
        accessKeyId: data.accessKeyId,
        secretAccessKey: data.secretAccessKey,
        sessionToken: data.sessionToken,
        region: data.region,
        vpcId: data.vpcId,
        subnetId: data.subnetId,
        keyPairName: data.keyPairName,
        instanceType: data.instanceType,
        ebsSize: data.ebsSize,
        ssmParamName: data.ssmParamName,
        provisioningKey: data.provisioningKey,
        stackName: data.scannerStackName || 'zpa-app-scanner'
      })
      setLaunched(true)
      setStackStatus('CREATE_IN_PROGRESS')
      pollRef.current = setInterval(() => pollStatus(), 5000)
    } catch (err) {
      setError(err.response?.data?.error || err.message)
      setDeploying(false)
    }
  }

  const pollStatus = async () => {
    try {
      const r = await axios.get('/api/aws/stack-status', {
        params: {
          stackName: data.scannerStackName || 'zpa-app-scanner',
          region: data.region,
          accessKeyId: data.accessKeyId,
          secretAccessKey: data.secretAccessKey,
          sessionToken: data.sessionToken
        }
      })
      setStackStatus(r.data.status)
      setStackOutputs(r.data.outputs || [])
      if (r.data.status === 'CREATE_COMPLETE' || r.data.status.includes('FAILED') || r.data.status.includes('ROLLBACK')) {
        clearInterval(pollRef.current)
        setDeploying(false)
        if (r.data.status === 'CREATE_COMPLETE') {
          const privateIp = r.data.outputs?.find(o => o.OutputKey === 'PrivateIp')?.OutputValue
          update({ scannerPrivateIp: privateIp })
        }
      }
    } catch (e) { /* ignore transient poll errors */ }
  }

  useEffect(() => () => clearInterval(pollRef.current), [])

  const statusClass = stackStatus === 'CREATE_COMPLETE' ? 'complete'
    : stackStatus.includes('FAILED') || stackStatus.includes('ROLLBACK') ? 'failed'
    : 'in-progress'

  if (isCloudShare) {
    return (
      <div className="card">
        <h2>Setup Script</h2>
        <p className="subtitle">Your setup script is pre-filled with all your configuration. {canRunRemote ? 'Run it on your CloudShare VM from here, or copy/download it and run it yourself.' : 'Copy or download it, then paste it into your CloudShare VM terminal as root or with sudo.'}</p>

        {scriptLoading && <div className="alert alert-info"><span className="spinner spinner-blue" /> Generating script...</div>}
        {error && <div className="alert alert-error">⚠️ {error}</div>}
        {script && (
          <>
            <div className="alert alert-success">✅ Script generated — ready to run on your CloudShare VM</div>
            <CodePreview code={script} filename="setup.sh" language="bash" />
            {canRunRemote && (
              <div style={{ marginTop: 16, padding: 14, border: '1px solid #bfdbfe', borderRadius: 8, background: '#eff6ff' }}>
                <strong>Run on {data.csVmName || 'the CloudShare VM'}</strong>
                <div style={{ fontSize: 13, color: '#475569', margin: '4px 0 10px' }}>
                  Uploads this script to the VM through the CloudShare API and starts it. It takes several minutes and reboots the VM when finished.
                </div>
                {(runState === 'idle' || runState === 'failed') && (
                  <button className="btn btn-primary" onClick={runOnVm}>
                    {runState === 'failed' ? '↻ Try again' : '▶ Run on VM'}
                  </button>
                )}
                {runState === 'starting' && <div><span className="spinner spinner-blue" /> Uploading script and starting it (about a minute)...</div>}
                {runState === 'running' && <div><span className="spinner spinner-blue" /> Script is running on the VM — log refreshes every 10 seconds</div>}
                {runState === 'done' && <div className="alert alert-success" style={{ margin: 0 }}><span>✅ Setup finished — the VM is rebooting. Give it a couple of minutes before the connector shows up in ZPA.</span></div>}
                {runError && <div className="alert alert-error" style={{ marginTop: 10 }}>⚠️ {runError}</div>}
                {runLog && (
                  <pre style={{ marginTop: 10, maxHeight: 260, overflow: 'auto', background: '#0f172a', color: '#e2e8f0', padding: 10, borderRadius: 6, fontSize: 12, whiteSpace: 'pre-wrap' }}>{runLog}</pre>
                )}
              </div>
            )}
            <div className="alert alert-warning" style={{ marginTop: 16 }}>
              ⚠️ {canRunRemote ? 'To run it yourself instead: ' : 'Run as: '}<code>sudo bash setup.sh</code> — requires root privileges
            </div>
          </>
        )}

        <div className="btn-row">
          <button className="btn btn-secondary" onClick={back}>← Back</button>
          <button className="btn btn-primary" onClick={next} disabled={!script || runState === 'starting' || runState === 'running'}>
            {runState === 'done' ? 'Continue →' : runState === 'running' || runState === 'starting' ? 'Waiting for script...' : 'Script Downloaded — Continue →'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="card">
      <h2>Deploy App Scanner to AWS</h2>
      <p className="subtitle">Review the CloudFormation template and launch your App Scanner EC2 instance. We'll store your provisioning key in SSM and poll the stack until it's ready.</p>

      {error && <div className="alert alert-error">⚠️ {error}</div>}

      {!launched && (
        <div className="alert alert-info">
          ℹ️ Clicking Launch will: store your provisioning key in SSM Parameter Store, then create a CloudFormation stack named <strong>{data.scannerStackName || 'zpa-app-scanner'}</strong> in <strong>{data.region}</strong>.
        </div>
      )}

      {launched && (
        <div className="stack-status">
          <h4>Stack Status</h4>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            {deploying && <span className="spinner spinner-blue" />}
            <span className={`status-label ${statusClass}`}>
              <span className={`status-dot ${statusClass === 'complete' ? 'success' : statusClass === 'failed' ? 'error' : 'running'}`} />
              {stackStatus}
            </span>
          </div>
          {stackOutputs.map(o => (
            <div key={o.OutputKey} style={{ fontSize: 13, marginBottom: 4 }}>
              <strong>{o.OutputKey}:</strong> {o.OutputValue}
            </div>
          ))}
          {stackStatus === 'CREATE_COMPLETE' && (
            <a className="portal-link" style={{ marginTop: 12, display: 'inline-flex' }}
              href={`https://${data.region}.console.aws.amazon.com/cloudformation/home?region=${data.region}#/stacks`}
              target="_blank" rel="noreferrer">
              🔗 View in AWS Console
            </a>
          )}
        </div>
      )}

      <div className="btn-row">
        <button className="btn btn-secondary" onClick={back} disabled={deploying}>← Back</button>
        {!launched ? (
          <button className="btn btn-primary" onClick={launchStack} disabled={deploying}>
            {deploying ? <><span className="spinner" /> Launching...</> : '🚀 Launch Stack'}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={next}
            disabled={stackStatus !== 'CREATE_COMPLETE'}>
            {stackStatus === 'CREATE_COMPLETE' ? 'Continue →' : 'Waiting for stack...'}
          </button>
        )}
      </div>
    </div>
  )
}
