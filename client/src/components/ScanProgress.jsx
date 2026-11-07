import React, { useEffect, useState } from 'react'
import axios from 'axios'
import { zpaAuth } from '../lib/zpa'
import { ElapsedBar, usePoll, dot, fmt } from './WaitStatus'

// Progress of App Shield scans. ZPA has no documented scan API, so this tries the portal's own
// endpoint (server side); when that isn't available it falls back to timers for scans the user
// says they started, with a link to the Shield page. Polls every 30s while something is active.
export default function ScanProgress({ data, update, compact }) {
  const [started, setStarted] = useState(data?.scanStarts || {})   // { segmentName: isoTime }
  const [newName, setNewName] = useState('')
  const [est, setEst] = useState(null)
  useEffect(() => { axios.get('/api/timings').then(r => setEst(r.data)).catch(() => {}) }, [])
  const level = (data?.probingLevel || 'HIGH').toLowerCase()
  const runEst = est?.[`scan.run.${level}`] || { typical: 480, max: 3600 }
  const pickupEst = est?.['scan.pickup'] || { typical: 120, max: 900 }

  const poll = usePoll(
    async () => (await axios.post('/api/zpa/scan-status', { ...zpaAuth(data) })).data,
    { every: 30000, until: r => r.supported && r.scans.length > 0 && r.scans.every(s => /completed|failed/i.test(s.status)), notifyText: r => `App Shield: ${r.scans.filter(s => /completed/i.test(s.status)).length} scan(s) completed`, deps: [] }
  )
  const live = poll.result
  const markStarted = (name) => { const next = { ...started, [name]: new Date().toISOString() }; setStarted(next); update && update({ scanStarts: next }) }
  const clear = (name) => { const next = { ...started }; delete next[name]; setStarted(next); update && update({ scanStarts: next }) }

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Scan progress</strong>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <a href="https://console.zscaler.com/private/autonomous-app-shield/shield" target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>Open Shield page ↗</a>
          <button onClick={poll.refresh} disabled={poll.status === 'running'} style={{ fontSize: 12 }}>{poll.status === 'running' || poll.status === 'refreshing' ? <span className="spinner spinner-blue" /> : '↻ Refresh'}</button>
        </span>
      </div>

      {live?.supported ? (
        <div style={{ marginTop: 8 }}>
          {live.scans.length === 0 && <div className="hint">No scan requests yet. Create and ▷ run them in the portal; they appear here within 30s.</div>}
          {live.scans.map(s => {
            const done = /completed/i.test(s.status), running = /progress/i.test(s.status), waiting = /requested/i.test(s.status)
            return (
              <div key={s.id} style={{ padding: '6px 0', borderTop: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span>{dot(done ? true : running ? null : waiting ? null : false)} <strong>{s.segment}</strong> <span className="hint">#{s.id} · {s.status}</span></span>
                  <span className="hint">{done ? `${s.cves ?? 0} CVE${s.cves === 1 ? '' : 's'}` : ''}</span>
                </div>
                {(waiting || running) && <ElapsedBar startedAt={s.startTime || s.requestedAt} estimate={waiting ? pickupEst : runEst} done={false} label={waiting ? 'Waiting for the scanner to pick it up' : 'Scanning'} />}
                {waiting && s.requestedAt && (Date.now() - new Date(s.requestedAt)) / 1000 > pickupEst.max && <div className="hint" style={{ color: '#b45309' }}>Longer than usual at Requested — check the scanner is Connected and the scan is assigned to the AppScanner connector; see the readiness panel above.</div>}
              </div>
            )
          })}
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          <div className="hint">{live && !live.supported ? live.reason : 'Checking whether this tenant exposes scan status…'} Track scans you start here instead: press ▷ in the portal, then add the segment name.</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. ZPA Shield - Apache httpd 2.4.49" style={{ flex: 1, padding: '4px 8px', fontSize: 13 }} onKeyDown={e => { if (e.key === 'Enter' && newName.trim()) { markStarted(newName.trim()); setNewName('') } }} />
            <button onClick={() => { if (newName.trim()) { markStarted(newName.trim()); setNewName('') } }} style={{ fontSize: 12 }}>Started ▷</button>
          </div>
          {Object.entries(started).map(([name, at]) => (
            <div key={name} style={{ padding: '6px 0', borderTop: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><strong>{name}</strong><button onClick={() => clear(name)} style={{ fontSize: 11 }}>done / clear</button></div>
              <ElapsedBar startedAt={at} estimate={{ typical: pickupEst.typical + runEst.typical, max: pickupEst.max + runEst.max }} done={false} label={`Expected: pickup ~${fmt(pickupEst.typical)}, then a ${level} scan ~${fmt(runEst.typical)}`} />
            </div>
          ))}
        </div>
      )}
      {poll.error && <div className="hint" style={{ color: '#b91c1c', marginTop: 6 }}>⚠️ {poll.error}</div>}
    </div>
  )
}
