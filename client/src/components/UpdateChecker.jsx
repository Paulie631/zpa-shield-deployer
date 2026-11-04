import React, { useState, useEffect } from 'react'
import axios from 'axios'

export default function UpdateChecker() {
  const [updateInfo, setUpdateInfo] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateStatus, setUpdateStatus] = useState('')
  const [checking, setChecking] = useState(false)
  const [currentVersion, setCurrentVersion] = useState('')

  useEffect(() => {
    // Fetch current version on mount
    axios.get('/api/update/version').then(r => setCurrentVersion(r.data.version)).catch(() => {})
  }, [])

  const checkForUpdates = async () => {
    setChecking(true)
    try {
      const res = await axios.get('/api/update/check')
      setUpdateInfo(res.data)
      if (res.data.hasUpdate) setShowModal(true)
      else setShowModal(true) // show "up to date" modal too
    } catch (err) {
      setUpdateInfo({ error: err.response?.data?.error || err.message })
      setShowModal(true)
    } finally {
      setChecking(false)
    }
  }

  const applyUpdate = async () => {
    setUpdating(true)
    setUpdateStatus('Downloading update...')
    try {
      await axios.post('/api/update/apply', {
        zipUrl: updateInfo.zipUrl,
        latestVersion: updateInfo.latestVersion
      })
      setUpdateStatus('Update downloading and installing... The app will restart automatically in ~30 seconds. Refresh this page after restart.')
    } catch (err) {
      setUpdateStatus(`Update failed: ${err.response?.data?.error || err.message}`)
      setUpdating(false)
    }
  }

  const hasUpdate = updateInfo?.hasUpdate

  return (
    <>
      {/* Header button — shows badge when update available */}
      <button
        className="update-btn"
        onClick={checkForUpdates}
        disabled={checking}
        title="Check for updates"
      >
        {checking ? (
          <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Checking...</>
        ) : (
          <>
            🔄 {currentVersion ? `v${currentVersion}` : 'Updates'}
            {hasUpdate && <span className="update-badge">●</span>}
          </>
        )}
      </button>

      {/* Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => !updating && setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            {updateInfo?.error ? (
              <>
                <h3>⚠️ Update Check Failed</h3>
                <p style={{ color: '#6b7280', fontSize: 14, margin: '12px 0' }}>{updateInfo.error}</p>
                <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
                  <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Close</button>
                </div>
              </>
            ) : updateInfo?.hasUpdate ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 28 }}>🎉</span>
                  <h3>Update Available</h3>
                </div>
                <div className="version-compare">
                  <span className="ver-chip current">v{updateInfo.currentVersion} current</span>
                  <span style={{ color: '#9ca3af', fontSize: 18 }}>→</span>
                  <span className="ver-chip latest">v{updateInfo.latestVersion} new</span>
                </div>

                <div className="release-notes">
                  <div className="release-notes-header">
                    <strong>{updateInfo.releaseName}</strong>
                    <span style={{ fontSize: 12, color: '#9ca3af' }}>
                      {new Date(updateInfo.publishedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <pre className="release-notes-body">{updateInfo.releaseNotes}</pre>
                </div>

                {updateStatus ? (
                  <div className={`alert ${updating ? 'alert-info' : updateStatus.includes('failed') ? 'alert-error' : 'alert-success'}`}
                    style={{ marginTop: 16 }}>
                    {updating && <span className="spinner spinner-blue" style={{ width: 14, height: 14, borderWidth: 2, marginRight: 8 }} />}
                    {updateStatus}
                  </div>
                ) : (
                  <div className="alert alert-warning" style={{ marginTop: 12 }}>
                    ⚠️ The app will restart automatically after updating. You'll need to refresh this page.
                  </div>
                )}

                <div className="btn-row" style={{ justifyContent: 'space-between', marginTop: 20 }}>
                  <a href={updateInfo.releaseUrl} target="_blank" rel="noreferrer"
                    style={{ fontSize: 13, color: '#0066CC', textDecoration: 'none' }}>
                    View release notes ↗
                  </a>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={updating}>
                      Later
                    </button>
                    <button className="btn btn-primary" onClick={applyUpdate}
                      disabled={updating || !updateInfo.zipUrl || !!updateStatus}>
                      {updating
                        ? <><span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Installing...</>
                        : '⬆ Install Update'}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div style={{ textAlign: 'center', padding: '12px 0' }}>
                  <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
                  <h3>You're up to date</h3>
                  <p style={{ color: '#6b7280', fontSize: 14, marginTop: 8 }}>
                    Running v{updateInfo?.currentVersion} — latest is v{updateInfo?.latestVersion}
                  </p>
                </div>
                <div className="btn-row" style={{ justifyContent: 'center', marginTop: 20 }}>
                  <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
