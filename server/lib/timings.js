// How long things usually take, learned per machine. Seeded with what we measured on a real
// tenant in Nov 2026; each completed wait nudges the estimate (exponential moving average) so
// the numbers get better for the user's own tenant/region. Stored next to the secrets vault.
const fs = require('fs');
const path = require('path');
const os = require('os');

const FILE = path.join(os.homedir(), '.zpa-shield', 'timings.json');

// seconds: { typical, max } — "typical" is what we show, "max" is when we start calling it slow
const SEED = {
  'testapps.core':      { typical: 150, max: 420,  label: 'DVWA / Juice Shop answering after launch' },
  'testapps.all':       { typical: 300, max: 660,  label: 'all test endpoints answering (Tomcat, WordPress last)' },
  'connector.enrol':    { typical: 240, max: 600,  label: 'App Connector enrolled and online' },
  'connector.upgrade':  { typical: 300, max: 900,  label: 'connector back online after a version-profile upgrade' },
  'scan.pickup':        { typical: 120, max: 900,  label: 'scan moves from Requested to In Progress' },
  'scan.run.high':      { typical: 480, max: 3600, label: 'High-intensity scan of one segment' },
  'scan.run.medium':    { typical: 240, max: 1800, label: 'Medium-intensity scan of one segment' },
  'scan.run.low':       { typical: 120, max: 900,  label: 'Low-intensity scan of one segment' },
};

function load() {
  try { return { ...SEED, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return { ...SEED }; }
}
function save(data) {
  try { fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 }); fs.writeFileSync(FILE, JSON.stringify(data, null, 2), { mode: 0o600 }); } catch { /* best effort */ }
}
function get(key) { return load()[key] || { typical: 300, max: 900, label: key }; }
function all() { return load(); }

// Record a measured duration (seconds). EMA with alpha 0.4 so one bad run doesn't swing it far.
function record(key, seconds) {
  if (!(seconds > 0) || seconds > 6 * 3600) return get(key);
  const data = load();
  const cur = data[key] || SEED[key] || { typical: seconds, max: seconds * 2, label: key };
  const typical = Math.round(cur.typical * 0.6 + seconds * 0.4);
  const max = Math.max(Math.round(cur.max * 0.8 + seconds * 1.5 * 0.2), typical * 2);
  data[key] = { ...cur, typical, max, samples: (cur.samples || 0) + 1, last: seconds, updated: new Date().toISOString() };
  save(data);
  return data[key];
}

const fmt = (s) => s < 90 ? `${Math.round(s)}s` : `${Math.round(s / 60)} min`;

module.exports = { get, all, record, fmt, FILE };
