// Mirror of server/lib/testApps.js for display (the server is the source of truth for what gets deployed)
export const TEST_APPS = [
  { key: 'dvwa',       name: 'ZPA Shield - DVWA',                   short: 'DVWA',                   port: 80,   scheme: 'http' },
  { key: 'dvwa-tls',   name: 'ZPA Shield - DVWA (TLS)',             short: 'DVWA over TLS',          port: 443,  scheme: 'https' },
  { key: 'juice',      name: 'ZPA Shield - Juice Shop',             short: 'Juice Shop',             port: 3000, scheme: 'http' },
  { key: 'juice-8080', name: 'ZPA Shield - Juice Shop (HTTP 8080)', short: 'Juice Shop on 8080',     port: 8080, scheme: 'http' },
  { key: 'juice-tls',  name: 'ZPA Shield - Juice Shop (TLS)',       short: 'Juice Shop over TLS',    port: 8443, scheme: 'https' },
  { key: 'webgoat',    name: 'ZPA Shield - WebGoat',                short: 'WebGoat',                port: 8081, scheme: 'http' },
]
export const urlFor = (ip, a) => `${a.scheme}://${ip}${(a.scheme === 'http' && a.port === 80) || (a.scheme === 'https' && a.port === 443) ? '' : ':' + a.port}/`
export const PORT_LIST = TEST_APPS.map(a => a.port).join(', ')
