import React, { useState, useEffect } from 'react'
import axios from 'axios'

// Checks a CloudShare VM can reach the internet (runs a small script on it via the CloudShare API).
export default function NetworkCheck({ vm, apiId, apiKey, autoRun = true, onResult }) {
  const [state, setState] = useState('idle') // idle | checking | done | error
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const running = vm && /running|ready/i.test(vm.statusText || '')

  const run = async () => {
    setState('checking'); setError(''); setResult(null)
    try {
      const r = await axios.post(`/api/cloudshare/vms/${encodeURIComponent(vm.id)}/check-network`, { apiId, apiKey }, { timeout: 120000 })
      setResult(r.data); setState('done'); onResult && onResult(r.data)
    } catch (e) {
      setError(e.response?.data?.error || e.message); setState('error'); onResult && onResult(null)
    }
  }

  useEffect(() => {
    setState('idle'); setResult(null); setError(''); onResult && onResult(undefined)
    if (vm && running && autoRun) run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vm?.id, running])

  if (!vm) return null
  const box = (bg, border) => ({ marginTop: 8, padding: '10px 12px', borderRadius: 8, fontSize: 13, background: bg, border: `1px solid ${border}` })
  const retry = <button onClick={run} style={{ marginLeft: 10, fontSize: 12, padding: '2px 8px', border: '1px solid #d1d5db', borderRadius: 4, background: '#fff', cursor: 'pointer' }}>↻ Check again</button>

  if (!running) return <div style={box('#fffbeb', '#fde68a')}>⏸ {vm.name} is <strong>{vm.statusText}</strong> — start it (resume the environment) to check its internet access.</div>
  if (state === 'idle') return <div style={box('#f8fafc', '#e2e8f0')}><button onClick={run} style={{ fontSize: 12, padding: '3px 10px', border: '1px solid #2563eb', borderRadius: 4, background: '#fff', color: '#2563eb', cursor: 'pointer' }}>🌐 Check internet access</button></div>
  if (state === 'checking') return <div style={box('#eff6ff', '#bfdbfe')}><span className="spinner spinner-blue" /> Checking {vm.name} can reach the internet (about 30 seconds)...</div>
  if (state === 'error') return <div style={box('#fef2f2', '#fecaca')}>⚠️ Couldn’t run the check on {vm.name}: {error}{retry}</div>

  const details = (
    <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#475569', marginTop: 6 }}>
      IP: {result.ips || 'none'} · route: {result.route === 'NONE' ? 'none' : 'yes'} · DNS: {result.dns} · ping 8.8.8.8: {result.ping} · HTTPS: {result.https}
    </div>
  )
  if (result.ok) return <div style={box('#f0fdf4', '#bbf7d0')}>✅ <strong>{vm.name}</strong> has internet access.{retry}{details}</div>
  if (result.dnsOnly) return <div style={box('#fffbeb', '#fde68a')}>⚠️ <strong>{vm.name}</strong>: {result.reason}{retry}{details}</div>
  return (
    <div style={box('#fef2f2', '#fecaca')}>
      ❌ <strong>{vm.name} has no internet access.</strong> {result.reason}{retry}{details}
      <div style={{ marginTop: 6 }}>Delete this VM in CloudShare and add one from a different template, or ask your CloudShare admin to allow internet access for it.</div>
    </div>
  )
}
