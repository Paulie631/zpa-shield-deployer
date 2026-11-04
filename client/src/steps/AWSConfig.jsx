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
    accessKeyId: data.accessKeyId || '',
    secretAccessKey: data.secretAccessKey || '',
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

  const fetchResources = async () => {
    if (!form.accessKeyId || !form.secretAccessKey || !form.region) return
    setLoadingResources(true)
    setResourceError('')
    try {
      const res = await axios.get('/api/aws/resources', {
        params: { accessKeyId: form.accessKeyId, secretAccessKey: form.secretAccessKey, region: form.region }
      })
      setResources(res.data)
    } catch (err) {
      setResourceError(err.response?.data?.error || 'Could not fetch AWS resources. Check your credentials and region.')
    } finally {
      setLoadingResources(false)
    }
  }

  const filteredSubnets = resources.subnets.filter(s => !form.vpcId || s.vpcId === form.vpcId)

  const canContinue = form.accessKeyId && form.secretAccessKey && form.region && form.vpcId && form.subnetId && form.keyPairName

  return (
    <div className="card">
      <h2>AWS Configuration</h2>
      <p className="subtitle">Enter your AWS credentials and select the target VPC, subnet, and key pair for the App Scanner instance.</p>

      <div className="disclaimer">🔒 AWS credentials are used only for this deployment request and are never stored.</div>

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

      <div className="form-row">
        <div className="form-group">
          <label>Region</label>
          <select value={form.region} onChange={e => set('region', e.target.value)}>
            {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
          <button className="btn btn-secondary" style={{ width: '100%' }} onClick={fetchResources} disabled={loadingResources || !form.accessKeyId || !form.secretAccessKey}>
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
        ⚠️ <strong>AMI Note:</strong> The default AMI is RHEL 9 for us-east-1. For other regions, update the AMI in the template preview before deploying. Find region AMIs at <a href="https://access.redhat.com/solutions/15356" target="_blank" rel="noreferrer">Red Hat's AMI list</a>.
      </div>

      {error && <div className="alert alert-error">⚠️ {error}</div>}

      <div className="btn-row">
        <button className="btn btn-secondary" onClick={back}>← Back</button>
        <button className="btn btn-primary" onClick={() => { update(form); next() }} disabled={!canContinue}>
          Continue →
        </button>
      </div>
    </div>
  )
}
