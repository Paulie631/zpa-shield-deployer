import React, { useState, useEffect } from 'react'
import axios from 'axios'

const REGIONS = [
  'us-east-1','us-east-2','us-west-1','us-west-2',
  'eu-west-1','eu-west-2','eu-west-3','eu-central-1','eu-north-1',
  'ap-southeast-1','ap-southeast-2','ap-northeast-1','ap-northeast-2',
  'ap-south-1','ca-central-1','sa-east-1'
]

export default function AWSConfig({ data, update, next, back }) {
  const [form, setForm] = useState({
    awsProfile: data.awsProfile || '',
    accessKeyId: data.accessKeyId || '',
    secretAccessKey: data.secretAccessKey || '',
    sessionToken: data.sessionToken || '',
    region: data.region || 'us-east-1',
    vpcId: data.vpcId || '',
    subnetId: data.subnetId || '',
    keyPairName: data.keyPairName || '',
    instanceType: data.instanceType || 'c5.4xlarge',
    ebsSize: data.ebsSize || '200',
    scannerStackName: data.scannerStackName || 'zpa-app-scanner',
  })
  const [resources, setResources] = useState({ vpcs: [], subnets: [], keyPairs: [] })
  const [loadingResources, setLoadingResources] = useState(false)
  const [resourceError, setResourceError] = useState('')
  const [error, setError] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // Credential source: a profile from the AWS CLI on this machine (SSO sessions refresh
  // themselves; expired ones need `aws sso login`) or keys pasted in
  const [credMode, setCredMode] = useState(data.awsProfile ? 'profile' : (data.accessKeyId ? 'keys' : 'profile'))
  const [profiles, setProfiles] = useState(null)
  const [whoami, setWhoami] = useState(null)      // { state, account, arn, expiration, error }
  useEffect(() => {
    axios.get('/api/aws/profiles').then(r => {
      const list = r.data.profiles || []
      setProfiles(list)
      if (!form.awsProfile && list.length) set('awsProfile', list.find(p => p !== 'default') || list[0])
      if (!list.length && !data.awsProfile && !data.accessKeyId) setCredMode('keys')
    }).catch(() => setProfiles([]))
  }, [])
  const authParams = () => credMode === 'profile'
    ? { awsProfile: form.awsProfile, region: form.region }
    : { accessKeyId: form.accessKeyId, secretAccessKey: form.secretAccessKey, sessionToken: form.sessionToken, region: form.region }
  const haveCreds = credMode === 'profile' ? !!form.awsProfile : (form.accessKeyId && form.secretAccessKey && (!/^ASIA/.test(form.accessKeyId.trim()) || form.sessionToken))

  const checkWhoami = async () => {
    setWhoami({ state: 'running' })
    try {
      const r = await axios.get('/api/aws/whoami', { params: authParams() })
      setWhoami({ state: 'ok', ...r.data })
    } catch (e) { setWhoami({ state: 'error', error: e.response?.data?.error || e.message }) }
  }
  useEffect(() => { if (credMode === 'profile' && form.awsProfile) checkWhoami() }, [credMode, form.awsProfile])

  const fetchResources = async () => {
    if (!haveCreds || !form.region) return
    setLoadingResources(true)
    setResourceError('')
    try {
      const res = await axios.get('/api/aws/resources', { params: authParams() })
      setResources(res.data)
    } catch (err) {
      setResourceError(err.response?.data?.error || 'Could not fetch AWS resources. Check your credentials and region.')
    } finally {
      setLoadingResources(false)
    }
  }

  const filteredSubnets = resources.subnets.filter(s => !form.vpcId || s.vpcId === form.vpcId)

  const isTempKey = /^ASIA/.test((form.accessKeyId || '').trim())
  const canContinue = haveCreds && form.region && form.vpcId && form.subnetId && form.keyPairName
  // What the later steps get: only the chosen credential source
  const toSave = () => credMode === 'profile'
    ? { ...form, accessKeyId: '', secretAccessKey: '', sessionToken: '' }
    : { ...form, awsProfile: '' }

  return (
    <div className="card">
      <h2>AWS Configuration</h2>
      <p className="subtitle">Enter your AWS credentials and select the target VPC, subnet, and key pair for the App Scanner instance.</p>

      <div className="disclaimer">🔒 AWS credentials go only to AWS. Pasted keys are kept in this browser tab until you close it; a CLI profile’s credentials never leave your machine.</div>

      <div style={{ display: 'flex', gap: 16, fontSize: 13, margin: '12px 0' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" style={{ width: 'auto' }} checked={credMode === 'profile'} onChange={() => setCredMode('profile')} /> Use my AWS CLI profile (recommended)</label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="radio" style={{ width: 'auto' }} checked={credMode === 'keys'} onChange={() => setCredMode('keys')} /> Paste access keys</label>
      </div>

      {credMode === 'profile' && (
        <div className="form-group">
          <label>AWS CLI profile</label>
          {profiles === null ? <div className="hint">Looking for profiles in ~/.aws...</div> : profiles.length === 0 ? (
            <div className="alert alert-warning" style={{ display: 'block' }}>
              No AWS CLI profiles found on this Mac. Set one up once, then come back:
              <pre style={{ marginTop: 6, background: '#1e293b', color: '#e2e8f0', padding: 8, borderRadius: 6, fontSize: 12 }}>{`brew install awscli      # if you don't have it
aws configure sso        # SSO start URL = your AWS access portal; name the profile e.g. "zscaler"
aws sso login --profile zscaler`}</pre>
              <button onClick={() => axios.get('/api/aws/profiles').then(r => setProfiles(r.data.profiles || []))} style={{ fontSize: 12, marginTop: 6 }}>↻ Look again</button>
            </div>
          ) : (
            <select value={form.awsProfile} onChange={e => set('awsProfile', e.target.value)}>
              {profiles.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          )}
          {whoami?.state === 'running' && <div className="hint"><span className="spinner spinner-blue" /> Checking the profile...</div>}
          {whoami?.state === 'ok' && (
            <div className="hint" style={{ color: '#16a34a' }}>
              ✅ Signed in as <code>{whoami.arn}</code> (account {whoami.account}){whoami.expiration ? ` — session valid until ${new Date(whoami.expiration).toLocaleTimeString()}` : ''}
            </div>
          )}
          {whoami?.state === 'error' && (
            <div className="alert alert-error" style={{ display: 'block', marginTop: 6 }}>
              ⚠️ {whoami.error}
              <div style={{ marginTop: 4 }}><button onClick={checkWhoami} style={{ fontSize: 12 }}>↻ Check again</button></div>
            </div>
          )}
          <div className="hint">SSO sessions refresh on their own while they last; when one expires, run <code>aws sso login --profile {form.awsProfile || 'NAME'}</code> in Terminal and click Check again.</div>
        </div>
      )}

      {credMode === 'keys' && (<>
      <div className="form-row">
        <div className="form-group">
          <label>AWS Access Key ID</label>
          <input type="text" placeholder="AKIAIOSFODNN7EXAMPLE" value={form.accessKeyId}
            onChange={e => set('accessKeyId', e.target.value)} />
        </div>
        <div className="form-group">
          <label>AWS Secret Access Key</label>
          <input type="password" placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfi..." value={form.secretAccessKey}
            onChange={e => set('secretAccessKey', e.target.value)} />
        </div>
      </div>

      <div className="form-group">
        <label>AWS Session Token {isTempKey ? <span style={{ color: '#dc2626' }}>*</span> : <span style={{ color: '#9ca3af', fontWeight: 400 }}>(only for temporary keys)</span>}</label>
        <input type="password" placeholder="IQoJb3JpZ2luX2VjE... (from the AWS access portal)" value={form.sessionToken}
          onChange={e => set('sessionToken', e.target.value)} />
        {isTempKey && !form.sessionToken && (
          <div className="hint" style={{ color: '#dc2626' }}>
            This is a temporary key (starts with ASIA), so AWS also needs its session token. In the AWS access portal, open “Access keys” for your account and copy <strong>AWS_SESSION_TOKEN</strong> as well.
          </div>
        )}
        {isTempKey && form.sessionToken && (
          <div className="hint">Temporary keys expire (usually after 1–12 hours). If AWS starts rejecting them, copy fresh ones from the portal.</div>
        )}
      </div>
      </>)}

      <div className="form-row">
        <div className="form-group">
          <label>Region</label>
          <select value={form.region} onChange={e => set('region', e.target.value)}>
            {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button className="btn btn-secondary" style={{ width: '100%' }} onClick={fetchResources} disabled={loadingResources || !haveCreds}>
            {loadingResources ? <><span className="spinner spinner-blue" /> Loading...</> : '🔍 Load VPCs & Subnets'}
          </button>
        </div>
      </div>

      {resourceError && <div className="alert alert-error">⚠️ {resourceError}</div>}

      <div className="form-row">
        <div className="form-group">
          <label>VPC</label>
          <select value={form.vpcId} onChange={e => { set('vpcId', e.target.value); set('subnetId', '') }}
            className={!form.vpcId && resources.vpcs.length ? 'error' : ''}>
            <option value="">-- Select VPC --</option>
            {resources.vpcs.map(v => <option key={v.id} value={v.id}>{v.name ? `${v.name} (${v.id})` : `${v.id} — ${v.cidr}`}</option>)}
            {!resources.vpcs.length && form.vpcId && <option value={form.vpcId}>{form.vpcId}</option>}
          </select>
          {!resources.vpcs.length && <div className="hint">Enter a VPC ID manually or click "Load VPCs & Subnets" above</div>}
        </div>
        <div className="form-group">
          <label>Subnet (Private recommended)</label>
          <select value={form.subnetId} onChange={e => set('subnetId', e.target.value)}>
            <option value="">-- Select Subnet --</option>
            {filteredSubnets.map(s => <option key={s.id} value={s.id}>{s.name ? `${s.name} (${s.id})` : `${s.id} — ${s.az} ${s.cidr}`}</option>)}
            {!filteredSubnets.length && form.subnetId && <option value={form.subnetId}>{form.subnetId}</option>}
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Key Pair Name</label>
          <select value={form.keyPairName} onChange={e => set('keyPairName', e.target.value)}>
            <option value="">-- Select Key Pair --</option>
            {resources.keyPairs.map(k => <option key={k.name} value={k.name}>{k.name}</option>)}
            {!resources.keyPairs.length && form.keyPairName && <option value={form.keyPairName}>{form.keyPairName}</option>}
          </select>
          {!resources.keyPairs.length && <div className="hint">Load resources above or type a key pair name manually</div>}
        </div>
        <div className="form-group">
          <label>Instance Type</label>
          <select value={form.instanceType} onChange={e => set('instanceType', e.target.value)}>
            <option value="c5.4xlarge">c5.4xlarge (16 vCPU / 32 GB) — Recommended</option>
            <option value="m5.4xlarge">m5.4xlarge (16 vCPU / 64 GB)</option>
            <option value="c5.2xlarge">c5.2xlarge (8 vCPU / 16 GB) — Minimum</option>
            <option value="m5.2xlarge">m5.2xlarge (8 vCPU / 32 GB)</option>
          </select>
        </div>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>EBS Volume Size (GB)</label>
          <input type="number" min="200" placeholder="200" value={form.ebsSize}
            onChange={e => set('ebsSize', e.target.value)} />
          <div className="hint">Minimum 200 GB recommended (120 GB free in /var required)</div>
        </div>
        <div className="form-group">
          <label>CloudFormation Stack Name</label>
          <input type="text" placeholder="zpa-app-scanner" value={form.scannerStackName}
            onChange={e => set('scannerStackName', e.target.value)} />
        </div>
      </div>

      <div className="alert alert-warning">
        ℹ️ <strong>AMI:</strong> the wizard picks the latest official RHEL 9 image for the region you choose.
      </div>

      {error && <div className="alert alert-error">⚠️ {error}</div>}

      <div className="btn-row">
        <button className="btn btn-secondary" onClick={back}>← Back</button>
        <button className="btn btn-primary" onClick={() => { update(toSave()); next() }} disabled={!canContinue}>
          Continue →
        </button>
      </div>
    </div>
  )
}
