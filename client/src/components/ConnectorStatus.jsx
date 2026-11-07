import React from 'react'
import axios from 'axios'
import { zpaAuth } from '../lib/zpa'
import { ElapsedBar, usePoll, dot } from './WaitStatus'

// Live state of the connectors in one or more groups: enrolled? online? upgrading? with elapsed
// time against the learned estimate. Polls every 30s until all are online; notifies once.
export default function ConnectorStatus({ data, groupNames, startedAt, title = 'Connector status', expectKey = 'connector.enrol' }) {
  const poll = usePoll(
    async () => (await axios.post('/api/zpa/connector-status', { ...zpaAuth(data), groupNames })).data,
    { every: 30000, until: r => r.connectors.length > 0 && r.connectors.every(c => c.online && !c.upgrading), notifyText: r => `${r.connectors.map(c => c.name).join(', ')} online in ZPA`, deps: [groupNames.join('|')] }
  )
  const r = poll.result
  const anyUpgrading = r?.connectors?.some(c => c.upgrading)
  const [est, setEst] = React.useState(null)
  React.useEffect(() => { axios.get('/api/timings').then(x => setEst(x.data[anyUpgrading ? 'connector.upgrade' : expectKey])).catch(() => {}) }, [anyUpgrading])
  const done = poll.status === 'done'
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{title}</strong>
        <button onClick={poll.refresh} disabled={poll.status === 'running'} style={{ fontSize: 12 }}>{poll.status === 'running' || poll.status === 'refreshing' ? <span className="spinner spinner-blue" /> : '↻ Check now'}</button>
      </div>
      <ElapsedBar startedAt={startedAt} estimate={est} done={done} label={done ? 'Online' : anyUpgrading ? 'Upgrading to the version profile (restarts once)' : r && !r.connectors.length ? 'Waiting for the connector to enrol' : 'Waiting for the connector to come online'} />
      {poll.error && <div className="alert alert-error" style={{ marginTop: 6 }}><span>⚠️ {poll.error}</span></div>}
      {r && !r.connectors.length && <div className="hint">No connector has enrolled in {groupNames.join(' / ')} yet. The VM installs the connector and enrols with the provisioning key on first boot — usually 3–5 minutes after the stack completes.</div>}
      {r?.connectors.map(c => (
        <div key={c.id} style={{ fontSize: 13, padding: '3px 0' }}>
          {dot(c.online && !c.upgrading)} <strong>{c.name}</strong> <span className="hint">({c.group})</span> — {c.online ? 'online' : c.status.replace(/^ZPN_STATUS_/, '').toLowerCase()}{c.version ? ` · ${c.version}` : ''}{c.upgrading ? ' · upgrading' : ''}
        </div>
      ))}
    </div>
  )
}
