// Template ranking for CloudShare VMs
// Rank VM templates for the test apps VM. Higher is better; below 0 means outdated.
// The test apps script supports apt (Ubuntu/Debian) and dnf (RHEL family).
export function rankTemplate(name = '') {
  const n = name.toLowerCase()
  if (/windows/.test(n)) return -100
  const ubuntu = n.match(/ubuntu[^0-9]*(\d{2})\.(\d{2})/)
  if (ubuntu) {
    const v = parseInt(ubuntu[1] + ubuntu[2], 10)        // 24.04 -> 2404
    const lts = ubuntu[2] === '04'
    if (v < 2004) return -10                            // 18.04 and older: out of support
    return lts ? 500 + (v - 2000) / 10 : 300 + (v - 2000) / 10   // LTS (24.04 -> 540) beats interim releases
  }
  if (/ubuntu/.test(n)) {
    if (/xenial|trusty|bionic|precise/.test(n)) return -10
    if (/noble/.test(n)) return 540
    if (/jammy/.test(n)) return 520
    if (/focal/.test(n)) return 500
    return 100                                          // Ubuntu, version unknown
  }
  const rhel = n.match(/(rocky|alma|rhel|red ?hat|centos stream|centos)[^0-9]*(\d+)/)
  if (rhel) {
    const v = parseInt(rhel[2], 10)
    if (v >= 9) return 520 - (/desktop|workstation|gui/.test(n) ? 5 : 0)
    if (v === 8) return 480
    return -10                                          // CentOS 7 and older
  }
  const debian = n.match(/debian[^0-9]*(\d+)/)
  if (debian) {
    const v = parseInt(debian[1], 10)
    return v >= 12 ? 510 : v === 11 ? 470 : -10
  }
  if (/rocky|alma|rhel|red ?hat|debian|centos|fedora|linux/.test(n)) return 50
  return -50                                            // not obviously Linux
}


// Rank templates for the App Scanner VM. Zscaler requires RHEL 9 (RPM install).
export function rankScannerTemplate(name = '') {
  const n = name.toLowerCase()
  if (/connector|app ?scanner|zscaler|zpa/.test(n)) return -20   // prebuilt Zscaler images are not supported
  const desktop = /desktop|workstation|gui/.test(n) ? -5 : 0      // prefer server editions
  const m = n.match(/(rhel|red ?hat[a-z ]*?)[^0-9]*(\d+)/)
  if (m) return parseInt(m[2], 10) === 9 ? 600 + desktop : -10
  const clone = n.match(/(rocky|alma)[^0-9]*(\d+)/)
  if (clone) return parseInt(clone[2], 10) === 9 ? 300 + desktop : -10   // RHEL-compatible, but not RHEL
  return -50
}

// What to say about the recommended scanner template
export function describeScannerTemplate(t) {
  if (t.rank >= 590) return 'Recommended — plain RHEL 9, as Zscaler requires for the App Scanner.'
  return `Best available — your account has no RHEL 9 template. ${t.name} is RHEL 9-compatible, but Zscaler only lists RHEL 9 for the App Scanner, so the install may refuse it. If it does, ask your CloudShare admin for a RHEL 9 template.`
}

export const SCANNER_SPEC = { numCpus: 16, memorySizeMBs: 16384, diskSizeGBs: 200 }
