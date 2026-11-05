// Secrets live in an owner-only file on this machine (~/.zpa-shield/secrets.json, mode 600),
// not in the browser. Routes receive them through the middleware below, which fills in
// any secret field the request left blank from the stored set for that service.
const fs = require('fs');
const os = require('os');
const path = require('path');

const DIR = path.join(os.homedir(), '.zpa-shield');
const FILE = path.join(DIR, 'secrets.json');

// Which fields each service may store, and which of those are secrets (never echoed back)
const FIELDS = {
  zpa:        { all: ['authMode', 'tenantUrl', 'cloudEnv', 'vanityDomain', 'clientId', 'clientSecret', 'apiKey', 'customerId'], secret: ['clientSecret', 'apiKey'] },
  cloudshare: { all: ['apiId', 'apiKey'], secret: ['apiKey'] },
  aws:        { all: ['accessKeyId', 'secretAccessKey', 'sessionToken'], secret: ['secretAccessKey', 'sessionToken'] },
};

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return {}; }
}
function save(data) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
  try { fs.chmodSync(FILE, 0o600); } catch (e) { /* best effort */ }
}

function set(kind, values) {
  if (!FIELDS[kind]) throw new Error(`Unknown secret kind "${kind}"`);
  const data = load();
  const cur = data[kind] || {};
  for (const k of FIELDS[kind].all) if (values[k] !== undefined) cur[k] = String(values[k]);
  data[kind] = cur;
  save(data);
  return status()[kind];
}
function clear(kind) {
  const data = load();
  delete data[kind];
  save(data);
}
function get(kind) { return load()[kind] || {}; }

// What's stored, without the secret values themselves
function status() {
  const data = load();
  const out = {};
  for (const kind of Object.keys(FIELDS)) {
    const v = data[kind] || {};
    const pub = {};
    for (const k of FIELDS[kind].all) if (!FIELDS[kind].secret.includes(k) && v[k]) pub[k] = v[k];
    out[kind] = { stored: FIELDS[kind].secret.some(k => v[k]), ...pub, secrets: FIELDS[kind].secret.filter(k => v[k]) };
  }
  return out;
}

// Express middleware: fill blank secret fields from the vault for the matching service
const KIND_BY_PATH = [['/api/zpa', 'zpa'], ['/api/cloudshare', 'cloudshare'], ['/api/aws', 'aws']];
function fillFromVault(req, res, next) {
  const hit = KIND_BY_PATH.find(([prefix]) => req.path.startsWith(prefix) || (req.baseUrl || '').startsWith(prefix));
  if (!hit) return next();
  const kind = hit[1];
  const stored = get(kind);
  if (!Object.keys(stored).length) return next();
  const fill = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    // AWS: a profile request never gets keys mixed in
    if (kind === 'aws' && obj.awsProfile) return;
    for (const k of FIELDS[kind].all) {
      if ((obj[k] === undefined || obj[k] === '' || obj[k] === null) && stored[k]) obj[k] = stored[k];
    }
  };
  fill(req.query);
  fill(req.body);
  next();
}

module.exports = { set, clear, get, status, fillFromVault, FILE };
