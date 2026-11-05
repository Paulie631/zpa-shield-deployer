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

// Progress survives page refreshes (like the one after installing an update) but not
// closing the tab: sessionStorage is per-tab and cleared when the tab closes.
const PROGRESS_KEY = 'zpa-shield-wizard-progress'
function loadProgress() {
  try { return JSON.parse(sessionStorage.getItem(PROGRESS_KEY)) || {} } catch { return {} }
}

export default function App() {
  const saved = loadProgress()
  const [step, setStep] = useState(Number.isInteger(saved.step) ? saved.step : 0)
  const [data, setData] = useState(saved.data || {})

  useEffect(() => {
    try { sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({ step, data })) } catch {}
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

  const steps = [
    'ZPA Credentials',
    'Choose Target',
    isAWS ? 'AWS Config' : 'CloudShare VMs',
    'Deploy Test Apps',
    'ZPA Setup',
    isAWS ? 'Deploy Scanner' : 'Setup Script',
    'Publish Apps',
    'Configure Scan',
    'Portal Steps',
    'Done'
  ]

  const renderStep = () => {
    switch (step) {
      case 0: return <ZPACredentials data={data} update={update} next={next} />
      case 1: return <ChooseTarget data={data} update={update} next={next} back={back} />
      case 2: return isAWS
        ? <AWSConfig data={data} update={update} next={next} back={back} />
        : <CloudShareConfig data={data} update={update} next={next} back={back} />
      // Test apps first: they need nothing from ZPA, and ZPA setup needs their address
      case 3: return <DeployTestApps data={data} update={update} next={next} back={back} />
      case 4: return <ZPASetup data={data} update={update} next={next} back={back} />
      case 5: return <DeployScanner data={data} update={update} next={next} back={back} isCloudShare={isCloudShare} />
      case 6: return <PublishApps data={data} update={update} next={next} back={back} />
      case 7: return <ScanConfig data={data} update={update} next={next} back={back} />
      case 8: return <PortalSteps data={data} update={update} next={next} back={back} />
      case 9: return <Done data={data} goTo={goTo} />
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
