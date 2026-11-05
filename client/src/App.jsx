import React, { useState, useEffect } from 'react'
import WizardShell from './components/WizardShell'
import ZPACredentials from './steps/ZPACredentials'
import ChooseTarget from './steps/ChooseTarget'
import AWSConfig from './steps/AWSConfig'
import CloudShareConfig from './steps/CloudShareConfig'
import ZPASetup from './steps/ZPASetup'
import DeployScanner from './steps/DeployScanner'
import DeployTestApps from './steps/DeployTestApps'
import ScanConfig from './steps/ScanConfig'
import PortalSteps from './steps/PortalSteps'
import Done from './steps/Done'
import PublishApps from './steps/PublishApps'
import VerifyAccess from './steps/VerifyAccess'

// Progress survives page refreshes (like the one after installing an update) but not
// closing the tab: sessionStorage is per-tab and cleared when the tab closes.
const PROGRESS_KEY = 'zpa-shield-wizard-progress'
function loadProgress() {
  try { return JSON.parse(sessionStorage.getItem(PROGRESS_KEY)) || {} } catch { return {} }
}

// Steps are identified by name so reordering the wizard in an update can't drop
// someone on the wrong step. ORDER is the flow; the two infra/scanner steps depend on target.
const ORDER = ['creds', 'target', 'infra', 'testapps', 'publish', 'verify', 'zpasetup', 'scanner', 'scan', 'portal', 'done']
// Layout before v1.3.36 (progress was saved by position), to map old saved progress
const OLD_ORDER = ['creds', 'target', 'infra', 'testapps', 'zpasetup', 'scanner', 'publish', 'scan', 'portal', 'done']
function savedStepIndex(saved) {
  if (saved.stepName && ORDER.includes(saved.stepName)) return ORDER.indexOf(saved.stepName)
  if (Number.isInteger(saved.step) && OLD_ORDER[saved.step]) return ORDER.indexOf(OLD_ORDER[saved.step])
  return 0
}

export default function App() {
  const saved = loadProgress()
  const [step, setStep] = useState(savedStepIndex(saved))
  const [data, setData] = useState(saved.data || {})

  useEffect(() => {
    try { sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({ stepName: ORDER[step], data })) } catch {}
  }, [step, data])

  const startOver = () => {
    if (!window.confirm('Start the wizard over? Anything already deployed stays where it is.')) return
    try { sessionStorage.removeItem(PROGRESS_KEY) } catch {}
    setData({}); setStep(0)
  }

  const update = (patch) => setData(d => ({ ...d, ...patch }))
  const next = () => setStep(s => s + 1)
  const back = () => setStep(s => s - 1)
  const goTo = (n) => setStep(n)

  // Dynamic step list based on target
  const isAWS = data.target === 'aws'
  const isCloudShare = data.target === 'cloudshare'

  // Short labels: eleven steps have to fit across the progress bar
  const steps = [
    'ZPA Login',
    'Target',
    isAWS ? 'AWS' : 'CloudShare',
    'Test Apps',
    'Publish',
    'Verify',
    'Scanner Key',
    isAWS ? 'Scanner' : 'Scanner Script',
    'Scan',
    'Portal',
    'Done'
  ]

  const renderStep = () => {
    switch (step) {
      case 0: return <ZPACredentials data={data} update={update} next={next} />
      case 1: return <ChooseTarget data={data} update={update} next={next} back={back} />
      case 2: return isAWS
        ? <AWSConfig data={data} update={update} next={next} back={back} />
        : <CloudShareConfig data={data} update={update} next={next} back={back} />
      // Apps first: deploy them, publish them through ZPA and prove access works,
      // then add the App Scanner and scan
      case 3: return <DeployTestApps data={data} update={update} next={next} back={back} />
      case 4: return <PublishApps data={data} update={update} next={next} back={back} />
      case 5: return <VerifyAccess data={data} update={update} next={next} back={back} />
      case 6: return <ZPASetup data={data} update={update} next={next} back={back} />
      case 7: return <DeployScanner data={data} update={update} next={next} back={back} isCloudShare={isCloudShare} />
      case 8: return <ScanConfig data={data} update={update} next={next} back={back} />
      case 9: return <PortalSteps data={data} update={update} next={next} back={back} />
      case 10: return <Done data={data} goTo={goTo} />
      default: return null
    }
  }

  return (
    <WizardShell steps={steps} currentStep={step}>
      {step > 0 && (
        <div style={{ textAlign: 'right', marginBottom: 8 }}>
          <button onClick={startOver} style={{ fontSize: 12, padding: '3px 10px', background: 'none', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', color: '#64748b' }}>↺ Start over</button>
        </div>
      )}
      {renderStep()}
    </WizardShell>
  )
}
