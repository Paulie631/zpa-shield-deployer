import axios from 'axios'
// CloudShare account details shared by the wizard steps
export const CS_STORAGE_KEY = 'zpa-cs-creds'
export const PROJECT_ID     = 'PRotcbPOeZ9_Dd4lJww1o-6A2'
export const POLICY_ID      = 'POEsi2O9SdO2D3GM-EZWuD6g2'
export const REGION_MIAMI   = 'REKolD1-ab84YIxODeMGob9A2'

// The API ID is remembered in the browser; the API key goes to the backend's owner-only
// secrets file and is filled in server-side whenever a request leaves it blank.
export function loadCSCreds() {
  try { const o = JSON.parse(localStorage.getItem(CS_STORAGE_KEY) || '{}'); delete o.apiKey; return o } catch { return {} }
}
export function saveCSCreds({ apiId, apiKey }) {
  try { localStorage.setItem(CS_STORAGE_KEY, JSON.stringify({ apiId })) } catch {}
  if (apiKey) axios.put('/api/vault/cloudshare', { apiId, apiKey }).catch(() => {})
}
export async function csSecretSaved() {
  try { return !!(await axios.get('/api/vault')).data.cloudshare?.stored } catch { return false }
}

// Blueprints that look like a Zscaler Client Connector test client
export const looksLikeZccBlueprint = (name = '') => /zcc|client ?connector|zscaler ?client|zapp|end ?user|win(dows)? ?1[01]/i.test(name)
