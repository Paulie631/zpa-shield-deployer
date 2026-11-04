import React from 'react'
import UpdateChecker from './UpdateChecker'

export default function WizardShell({ steps, currentStep, children }) {
  return (
    <div>
      <header className="app-header">
        <span className="shield-icon">🛡️</span>
        <h1>ZPA Autonomous Application Shield — Deployment Wizard</h1>
        <div style={{ marginLeft: 'auto' }}>
          <UpdateChecker />
        </div>
      </header>
      <div className="wizard-container">
        <div className="progress-bar">
          {steps.map((label, i) => (
            <div
              key={i}
              className={`progress-step ${i === currentStep ? 'active' : ''} ${i < currentStep ? 'completed' : ''}`}
            >
              <div className="step-dot">
                {i < currentStep ? '✓' : i + 1}
              </div>
              <span className="step-label">{label}</span>
            </div>
          ))}
        </div>
        {children}
      </div>
    </div>
  )
}
