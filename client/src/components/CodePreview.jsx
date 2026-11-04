import React, { useState } from 'react'

export default function CodePreview({ code, filename, language = 'json' }) {
  const [collapsed, setCollapsed] = useState(true)

  const copy = () => {
    navigator.clipboard.writeText(code)
      .then(() => alert('Copied to clipboard!'))
      .catch(() => alert('Copy failed — please select and copy manually.'))
  }

  const download = () => {
    const blob = new Blob([code], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename || 'file.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className={`code-preview ${collapsed ? 'collapsed' : ''}`}>
      <div className="code-preview-header">
        <span>{filename || 'code'}</span>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8', border: 'none', cursor: 'pointer', borderRadius: '6px', padding: '4px 10px', fontSize: '12px' }}
            onClick={() => setCollapsed(c => !c)}>
            {collapsed ? '⬇ Expand' : '⬆ Collapse'}
          </button>
          <button className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8', border: 'none', cursor: 'pointer', borderRadius: '6px', padding: '4px 10px', fontSize: '12px' }}
            onClick={copy}>📋 Copy</button>
          {filename && (
            <button className="btn btn-sm" style={{ background: '#334155', color: '#94a3b8', border: 'none', cursor: 'pointer', borderRadius: '6px', padding: '4px 10px', fontSize: '12px' }}
              onClick={download}>⬇ Download</button>
          )}
        </div>
      </div>
      <pre>{code}</pre>
    </div>
  )
}
