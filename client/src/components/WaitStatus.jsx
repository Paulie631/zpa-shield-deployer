import React, { useEffect, useRef, useState } from 'react'
import axios from 'axios'

// Elapsed time vs. a learned estimate, with a progress bar that goes amber past "typical"
// and red past "max". `startedAt` is an ISO string or ms; `estimate` is { typical, max } in seconds.
export const fmt = (s) => s == null ? '—' : s < 90 ? `${Math.round(s)}s` : `${Math.floor(s / 60)} min${s % 60 >= 30 ? ' 30s' : ''}`

export function useTicker(ms = 1000) {
  const [, set] = useState(0)
  useEffect(() => { const t = setInterval(() => set(x => x + 1), ms); return () => clearInterval(t) }, [ms])
}

export function ElapsedBar({ startedAt, estimate, done, label }) {
  useTicker(1000)
  if (!startedAt) return null
  const elapsed = Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000))
  const typical = estimate?.typical || 300, max = estimate?.max || typical * 2
  const pct = Math.min(100, Math.round((elapsed / typical) * 100))
  const tone = done ? '#16a34a' : elapsed > max ? '#dc2626' : elapsed > typical ? '#d97706' : '#2563eb'
  const text = done ? `Done in ${fmt(elapsed)}` : elapsed > max ? `${fmt(elapsed)} — longer than usual (${fmt(max)}); worth checking` : elapsed > typical ? `${fmt(elapsed)} — usually ${fmt(typical)}, allow up to ${fmt(max)}` : `${fmt(elapsed)} of ~${fmt(typical)}`
  return (
    <div style={{ margin: '6px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#475569' }}><span>{label}</span><span style={{ color: tone }}>{text}</span></div>
      <div style={{ height: 6, background: '#e2e8f0', borderRadius: 3, marginTop: 3 }}><div style={{ width: `${done ? 100 : pct}%`, height: 6, background: tone, borderRadius: 3, transition: 'width 1s linear' }} /></div>
    </div>
  )
}

// Poll `fn` every `every` ms until `until(result)` is true; fires a desktop notification once.
export function usePoll(fn, { every = 30000, until, enabled = true, notifyText, deps = [] } = {}) {
  const [state, setState] = useState({ status: 'idle', result: null, error: null, at: null })
  const notified = useRef(false)
  const timer = useRef(null)
  const run = async () => {
    setState(s => ({ ...s, status: s.result ? 'refreshing' : 'running' }))
    try {
      const result = await fn()
      const finished = until ? until(result) : false
      setState({ status: finished ? 'done' : 'waiting', result, error: null, at: Date.now() })
      if (finished && notifyText && !notified.current) { notified.current = true; axios.post('/api/timings/notify', { message: typeof notifyText === 'function' ? notifyText(result) : notifyText }).catch(() => {}) }
      if (!finished && enabled) timer.current = setTimeout(run, every)
    } catch (e) {
      setState(s => ({ ...s, status: 'error', error: e.response?.data?.error || e.message, at: Date.now() }))
      if (enabled) timer.current = setTimeout(run, every)
    }
  }
  useEffect(() => { if (!enabled) return; run(); return () => clearTimeout(timer.current) }, [enabled, ...deps]) // eslint-disable-line
  return { ...state, refresh: () => { clearTimeout(timer.current); run() } }
}

export const dot = (ok) => ok === true ? '🟢' : ok === false ? '🔴' : '🟡'
