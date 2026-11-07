import React, { useEffect, useState } from 'react'
import axios from 'axios'
import { zpaAuth } from '../lib/zpa'

// Segments in the ZPA Shield Test Apps group that don't point at the current test-apps IP
// (left over from a previous instance). Offers one-click delete so they don't get scanned.
export default function StaleSegments({ data, ip, onChanged }) {
  const [state, setState] = useState({ loading: false, stale: [], error: '' })
  const load = async () => {
    if (!ip) return
    setState(s => ({ ...s, loading: true, error: '' }))
    try { const r = await axios.post('/api/zpa/stale-segments', { ...zpaAuth(data), ip }); setState({ loading: false, stale: r.data.stale || [], error: '' }) }
    catch (e) { setState({ loading: false, stale: [], error: e.response?.data?.error || e.message }) }
  }
  useEffect(() => { load() }, [ip])
  const del = async (seg) => {
    if (!window.confirm(`Delete app segment "${seg.name}" (${seg.hosts.join(', ')})? Scans that target it will stop.`)) return
    try { await axios.post('/api/zpa/delete-segment', { ...zpaAuth(data), id: seg.id }); await load(); onChanged && onChanged() }
    catch (e) { setState(s => ({ ...s, error: e.response?.data?.error || e.message })) }
  }
  if (!ip || (!state.stale.length && !state.error)) return null
  return (
    <div className="alert alert-warning" style={{ display: 'block', marginBottom: 12 }}>
      <strong>⚠️ {state.stale.length} segment{state.stale.length === 1 ? '' : 's'} in “ZPA Shield Test Apps” point at an old address</strong>
      <div className="hint" style={{ marginTop: 4 }}>The test apps are now at <code>{ip}</code>. These still target a previous instance, so scans of them find nothing (or stay “Requested”). Delete them, or edit them in ZPA to the new host.</div>
      {state.stale.map(s => (
        <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '3px 0' }}>
          <span><strong>{s.name}</strong> → {s.hosts.join(', ')}{s.ports.length ? ` : ${s.ports.join(', ')}` : ''}</span>
          <button onClick={() => del(s)} style={{ fontSize: 12 }}>Delete</button>
        </div>
      ))}
      {state.error && <div style={{ color: '#b91c1c', fontSize: 13 }}>⚠️ {state.error}</div>}
    </div>
  )
}
