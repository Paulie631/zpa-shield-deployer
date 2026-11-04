import React, { useState } from 'react'
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

export default function App() {
  const [step, setStep] = useState(0)
  const [data, setData] = useState({})

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
    isAWS ? 'AWS Config' : 'CloudShare VM',
    'ZPA Setup',
    isAWS ? 'Deploy Scanner' : 'Setup Script',
    'Deploy Test Apps',
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
      case 3: return <ZPASetup data={data} update={update} next={next} back={back} />
      case 4: return <DeployScanner data={data} update={update} next={next} back={back} isCloudShare={isCloudShare} />
      case 5: return <DeployTestApps data={data} update={update} next={next} back={back} />
      case 6: return <ScanConfig data={data} update={update} next={next} back={back} />
      case 7: return <PortalSteps data={data} update={update} next={next} back={back} />
      case 8: return <Done data={data} goTo={goTo} />
      default: return null
    }
  }

  return (
    <WizardShell steps={steps} currentStep={step}>
      {renderStep()}
    </WizardShell>
  )
}
