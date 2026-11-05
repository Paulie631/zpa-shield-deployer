// Shared ZPA helpers for the wizard steps

// The numeric ZPA customer ID is remembered per tenant (same store as the ZPA Setup step)
const CID_STORAGE_KEY = 'zpa-shield-customer-ids'
const tenantKeyOf = (data) => data.vanityDomain || data.tenantUrl || 'default'
export function savedCustomerId(data) {
  try { return JSON.parse(localStorage.getItem(CID_STORAGE_KEY) || '{}')[tenantKeyOf(data)] || '' } catch { return '' }
}
export function rememberCustomerId(data, cid) {
  try {
    const all = JSON.parse(localStorage.getItem(CID_STORAGE_KEY) || '{}')
    all[tenantKeyOf(data)] = cid
    localStorage.setItem(CID_STORAGE_KEY, JSON.stringify(all))
  } catch {}
}

// Auth params every /api/zpa call needs
export function zpaAuth(data) {
  return {
    authMode: data.authMode, tenantUrl: data.tenantUrl, apiKey: data.apiKey,
    clientId: data.clientId, clientSecret: data.clientSecret,
    cloudEnv: data.cloudEnv, vanityDomain: data.vanityDomain,
    customerId: data.customerId || savedCustomerId(data),
  }
}

// ZPA admin portal for the tenant. API key / OAuth modes have the tenant URL;
// OneAPI mode only knows the cloud, so use that cloud's admin portal.
const ADMIN_BY_CLOUD = {
  'zscaler.com': 'admin.private.zscaler.com',
  'zscalertwo.net': 'admin.zpatwo.net',
  'zscalerthree.net': 'admin.zpathree.net',
  'zscalerbeta.net': 'admin.zpabeta.net',
  'zscalerone.net': 'admin.zpaone.net',
}
export function zpaPortalBase(data) {
  if (data.tenantUrl) return `https://${data.tenantUrl}`
  return `https://${ADMIN_BY_CLOUD[data.cloudEnv] || 'admin.private.zscaler.com'}`
}
