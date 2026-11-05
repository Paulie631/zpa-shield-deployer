import React, { useState, useEffect, useRef } from 'react'
import axios from 'axios'

// Adds a VM from a CloudShare template to an environment, waits for it to start,
// then optionally resizes it. `rank(name)` orders templates (higher is better, < 0 = not recommended).
export default function AddVmPanel({ apiId, apiKey, envId, regionId, existingVmIds, rank, title, vmName,
  preferredName, recommendedText, noneText, resize, onAdded, onCancel }) {
  const [templates, setTemplates] = useState(null)
  const [templateId, setTemplateId] = useState('')
  const [filter, setFilter] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pollRef = useRef(null)
  useEffect(() => () => clearInterval(pollRef.current), [])

  useEffect(() => {
    axios.get('/api/cloudshare/templates', { params: { apiId, apiKey, regionId } })
      .then(r => {
        const pref = (preferredName || '').trim().toLowerCase()
        const list = (r.data || []).map(t => ({ ...t, rank: (pref && t.name.toLowerCase() === pref) ? 10000 : rank(t.name) }))
          .sort((a, b) => b.rank - a.rank
            || ((b.resources?.memorySizeMB || 0) - (a.resources?.memorySizeMB || 0))
            || a.name.localeCompare(b.name))
        setTemplates(list)
        if (list[0] && list[0].rank > 0) setTemplateId(list[0].id)
      })
      .catch(e => { setError(e.response?.data?.error || e.message); setTemplates([]) })
  }, [])

  const add = async () => {
    setBusy(true); setError(''); setStatus('🚀 Adding VM to the environment...')
    const before = new Set(existingVmIds)
    try {
      await axios.post(`/api/cloudshare/envs/${envId}/vms`, { apiId, apiKey, templateVmId: templateId, name: vmName })
      let attempts = 0
      pollRef.current = setInterval(async () => {
        attempts++
        try {
          const detail = await axios.get(`/api/cloudshare/envs/${envId}`, { params: { apiId, apiKey } })
          const added = (detail.data.vms || []).find(v => !before.has(v.id))
          setStatus(`⏳ Environment: ${detail.data.statusText} | New VM: ${added?.statusText || 'not listed yet'} — please wait...`)
          if (added && detail.data.statusText === 'Ready' && /running|ready/i.test(added.statusText || '')) {
            clearInterval(pollRef.current)
            let note = ''
            if (resize) {
              setStatus(`🔧 Resizing ${added.name} to ${resize.numCpus} vCPU, ${resize.memorySizeMBs / 1024} GB RAM, ${resize.diskSizeGBs} GB disk...`)
              try {
                const r = await axios.put(`/api/cloudshare/vms/${added.id}/hardware`, { apiId, apiKey, ...resize })
                if (r.data?.conflictsFound) note = `CloudShare reported a conflict resizing: ${r.data.conflicts}. Check the VM size in CloudShare.`
              } catch (e) { note = 'Resize failed: ' + (e.response?.data?.error || e.message) + '. Resize the VM in CloudShare before installing the scanner.' }
            }
            const fresh = await axios.get(`/api/cloudshare/envs/${envId}`, { params: { apiId, apiKey } }).catch(() => detail)
            setBusy(false); setStatus('')
            onAdded(fresh.data, added.id, note)
          } else if (attempts > 75) {
            clearInterval(pollRef.current)
            setBusy(false)
            setStatus('⚠️ The new VM is taking longer than expected — check the CloudShare portal, then pick it here once it is running.')
            onAdded(detail.data, added?.id || '', '')
          }
        } catch (e) { /* ignore poll errors */ }
      }, 8000)
    } catch (err) {
      setBusy(false); setStatus('')
      setError(err.response?.data?.error || err.message || 'Failed to add VM')
    }
  }

  const shown = (templates || []).filter(t => filter ? t.name.toLowerCase().includes(filter.toLowerCase()) : t.rank > -50)
  const best = templates?.[0]?.rank ?? 0
  const chosen = (templates || []).find(t => t.id === templateId)

  return (
    <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '16px', marginTop: '8px' }}>
      <div style={{ fontWeight: 600, marginBottom: '8px' }}>{title}</div>
      {status && <div className="alert alert-info" style={{ marginBottom: '10px' }}><span>{status}</span></div>}
      {!busy && (templates === null ? (
        <div style={{ fontSize: '13px', color: '#64748b' }}>🔄 Loading templates...</div>
      ) : (
        <>
          <input type="text" placeholder="Filter templates by name" value={filter}
            onChange={e => setFilter(e.target.value)} style={{ marginBottom: '8px' }} />
          <select value={templateId} onChange={e => setTemplateId(e.target.value)}>
            <option value="">— Select a template ({shown.length} shown) —</option>
            {shown.map(t => (
              <option key={t.id} value={t.id}>
                {t.rank === best && t.rank > 0 ? '★ ' : ''}{t.name}{t.resources ? ` — ${t.resources.cpuCount} vCPU, ${Math.round(t.resources.memorySizeMB / 1024)} GB RAM` : ''}{t.rank < 0 && t.rank > -50 ? ' (not recommended)' : ''}
              </option>
            ))}
          </select>
          {chosen && chosen.rank > 0 && chosen.rank === best && <div className="hint" style={{ color: '#16a34a' }}>★ {recommendedText}</div>}
          {chosen && chosen.rank < 0 && <div className="hint" style={{ color: '#dc2626' }}>This template isn’t recommended for this VM — pick a ★ one if you can.</div>}
          {templates.length > 0 && best <= 0 && <div className="hint" style={{ color: '#d97706' }}>{noneText}</div>}
          <div className="hint">After it starts, the wizard checks the VM can reach the internet.{resize ? ` It is then resized to ${resize.numCpus} vCPU / ${resize.memorySizeMBs / 1024} GB RAM / ${resize.diskSizeGBs} GB disk.` : ''}</div>
          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <button className="btn btn-primary" onClick={add} disabled={!templateId} style={{ fontSize: '13px' }}>➕ Add VM</button>
            <button onClick={onCancel} style={{ fontSize: '13px', padding: '6px 14px', background: 'none', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer' }}>Cancel</button>
          </div>
        </>
      ))}
      {error && <div className="alert alert-error" style={{ marginTop: 10 }}>⚠️ {error}</div>}
    </div>
  )
}
