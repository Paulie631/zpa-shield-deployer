// CloudShare account details shared by the wizard steps
export const CS_STORAGE_KEY = 'zpa-cs-creds'
export const PROJECT_ID     = 'PRotcbPOeZ9_Dd4lJww1o-6A2'
export const POLICY_ID      = 'POEsi2O9SdO2D3GM-EZWuD6g2'
export const REGION_MIAMI   = 'REKolD1-ab84YIxODeMGob9A2'

export function loadCSCreds() {
  try { return JSON.parse(localStorage.getItem(CS_STORAGE_KEY) || '{}') } catch { return {} }
}
export function saveCSCreds(obj) {
  try { localStorage.setItem(CS_STORAGE_KEY, JSON.stringify(obj)) } catch {}
}

// Blueprints that look like a Zscaler Client Connector test client
export const looksLikeZccBlueprint = (name = '') => /zcc|client ?connector|zscaler ?client|zapp|end ?user|win(dows)? ?1[01]/i.test(name)
