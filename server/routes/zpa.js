const express = require('express');
const router = express.Router();
const axios = require('axios');

// ─── Auth helpers ────────────────────────────────────────────────────────────

// Tenant-scoped OAuth (classic ZPA)
async function getTenantToken(tenantUrl, clientId, clientSecret) {
  const res = await axios.post(`https://${tenantUrl}/oauth/token`, null, {
    params: { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret },
    timeout: 10000
  });
  return res.data.access_token;
}

// Zidentity OAuth for OneAPI
// Token endpoint: https://{vanityDomain}.zslogin.net/oauth2/v1/token
// vanityDomain = company slug, e.g. "acme" → acme.zslogin.net
async function getOneApiToken(clientId, clientSecret, vanityDomain) {
  if (!vanityDomain) throw new Error('vanityDomain is required for OneAPI auth (e.g. "acme" from acme.zslogin.net)');
  const tokenUrl = `https://${vanityDomain}.zslogin.net/oauth2/v1/token`;
  const res = await axios.post(tokenUrl,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      audience: 'https://api.zscaler.com',
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }, timeout: 10000 }
  );
  return res.data.access_token;
}

// OneAPI gateway. Every ZPA call made with a Zidentity (OneAPI) token goes through
// this gateway — never the legacy config.<cloud> hosts, which only accept tokens
// from legacy ZPA API keys. Source: zscaler-sdk-python RequestExecutor.
const ONEAPI_GOV_GATEWAY = {
  'zscalergov.net': 'https://api.zscalergov.net',
  'zscalergov.us':  'https://api.zscalergov.us',
};
function oneApiGateway(cloudEnv) {
  return ONEAPI_GOV_GATEWAY[cloudEnv] || 'https://api.zsapi.net';
}

// The ZPA customer ID is a long numeric ID (e.g. 216196257331281920) from the ZPA
// console. It is NOT the Zidentity tenant ID (a UUID) — sending a UUID gets a 400.
function checkZpaCustomerId(customerId) {
  const id = String(customerId || '').trim();
  if (!id) {
    const e = new Error('ZPA Customer ID is required. Find it in the ZPA console under Configuration & Control > Public API > API Keys.');
    e.code = 'CUSTOMER_ID_MISSING'; throw e;
  }
  if (!/^\d+$/.test(id)) {
    const e = new Error(`"${id}" is not a ZPA Customer ID. It must be the numeric ZPA tenant ID (digits only), not the Zidentity tenant ID. Find it in the ZPA console under Configuration & Control > Public API > API Keys.`);
    e.code = 'CUSTOMER_ID_INVALID'; throw e;
  }
  return id;
}

// Enrollment certs live under mgmtconfig v2 (everything else used here is v1)
const ENROLLMENT_CERT_URL = (mgmtBase) => mgmtBase.replace('/mgmtconfig/v1/', '/mgmtconfig/v2/') + '/enrollmentCert';

// One place to turn an axios/ZPA error into a message for the UI
function zpaError(err) {
  const d = err.response?.data;
  return (d && (d.message || d.reason || d.exception)) || err.message;
}

/**
 * Returns { headers, base } ready to make ZPA API calls.
 * authMode: 'apikey' | 'oauth' | 'oneapi'
 */
async function getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId }) {
  switch (authMode) {
    case 'apikey': {
      return {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        base: `https://${tenantUrl}/api/v1`,
        mgmtBase: `https://${tenantUrl}/mgmtconfig/v1/admin/customers/${customerId}`,
      };
    }
    case 'oauth': {
      const token = await getTenantToken(tenantUrl, clientId, clientSecret);
      return {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        base: `https://${tenantUrl}/api/v1`,
        mgmtBase: `https://${tenantUrl}/mgmtconfig/v1/admin/customers/${customerId}`,
      };
    }
    case 'oneapi': {
      const id = checkZpaCustomerId(customerId);
      const token = await getOneApiToken(clientId, clientSecret, vanityDomain);
      if (!token) throw new Error('OneAPI token was empty/undefined');
      const mgmtBase = `${oneApiGateway(cloudEnv)}/zpa/mgmtconfig/v1/admin/customers/${id}`;
      return {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        base: mgmtBase,
        mgmtBase,
      };
    }
    default:
      throw new Error(`Unknown authMode: ${authMode}`);
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// GET /api/zpa/validate
router.get('/validate', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain } = req.query;
  try {
    let headers, base;
    // OneAPI: getting a token proves the client ID / secret / vanity domain.
    // ZPA data needs the numeric ZPA customer ID, which is entered on the setup step
    // (OneAPI has no endpoint to look it up), so only load lists if we already have it.
    if (authMode === 'oneapi') {
      const token = await getOneApiToken(clientId, clientSecret, vanityDomain);
      if (!token) throw new Error('Failed to obtain OneAPI token');
      const customerId = String(req.query.customerId || '').trim();
      if (!/^\d+$/.test(customerId)) {
        return res.json({ valid: true, authMode, customerId: null, connectorGroups: [], appSegments: [] });
      }
      headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      base = `${oneApiGateway(cloudEnv)}/zpa/mgmtconfig/v1/admin/customers/${customerId}`;
      const [cgRes, asRes] = await Promise.allSettled([
        axios.get(base + '/appConnectorGroup', { headers, timeout: 10000 }),
        axios.get(base + '/application', { headers, timeout: 10000 }),
      ]);
      const parseList = (r) => {
        if (r.status !== 'fulfilled') return [];
        const d = r.value.data;
        return d.list || d.appConnectorGroups || d.applications || (Array.isArray(d) ? d : []);
      };
      return res.json({ valid: true, authMode, base, customerId, connectorGroups: parseList(cgRes), appSegments: parseList(asRes) });
    }
    // Legacy apikey/oauth
    const client = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain });
    headers = client.headers; base = client.base;
    const [cgRes, asRes] = await Promise.allSettled([
      axios.get(base + '/appConnectorGroup', { headers, timeout: 10000 }),
      axios.get(base + '/application', { headers, timeout: 10000 }),
    ]);
    const parseList = (r) => {
      if (r.status !== 'fulfilled') return [];
      const d = r.value.data;
      return d.list || d.appConnectorGroups || d.applications || (Array.isArray(d) ? d : []);
    };
    res.json({ valid: true, authMode, base, connectorGroups: parseList(cgRes), appSegments: parseList(asRes) });
  } catch (err) {
    console.error('[validate error]', err.response?.status, err.response?.data, err.message);
    res.status(401).json({ valid: false, error: zpaError(err) });
  }
});
// POST /api/zpa/scan
router.post('/scan', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain,
    appSegmentIds, probingLevel, frequency, startTime, scanName, scannerConnectorId, customerId } = req.body;
  try {
    const { headers, mgmtBase: base } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId });

    const profileRes = await axios.post(`${base}/appProtection/scanProfile`, {
      name: `${scanName} Profile`,
      probingLevel: probingLevel.toUpperCase(),
      frequency: frequency.toUpperCase(),
      startTime
    }, { headers });

    const scanProfileId = profileRes.data.id;

    const scanRes = await axios.post(`${base}/appProtection/scan`, {
      name: scanName,
      status: 'ENABLED',
      scanProfileId,
      appSegmentIds,
      appScannerIds: scannerConnectorId ? [scannerConnectorId] : []
    }, { headers });

    res.json({ scanProfileId, scanId: scanRes.data.id });
  } catch (err) {
    res.status(400).json({ error: zpaError(err) });
  }
});

// POST /api/zpa/app-segments
// POST /api/zpa/test-app-segments — create everything ZPA needs to publish the test apps:
// a segment group, a server group (bound to an App Connector group) and one app segment per app.
// Re-running is safe: objects with the same names are reused, not duplicated.
const TEST_APPS = [
  { name: 'ZPA Shield - DVWA', port: 80 },
  { name: 'ZPA Shield - Juice Shop', port: 3000 },
];
const TEST_SEGMENT_GROUP = 'ZPA Shield Test Apps';
const TEST_SERVER_GROUP = 'ZPA Shield Test Apps';

// ZPA's `search` filter rejects names with spaces ("Invalid operand"), so page through
// the full list and match the name exactly.
async function findByName(base, headers, path, name) {
  for (let page = 1; page <= 20; page++) {
    const r = await axios.get(`${base}/${path}`, { headers, params: { page, pagesize: 500 }, timeout: 15000 });
    const list = r.data.list || (Array.isArray(r.data) ? r.data : []);
    const hit = list.find(x => x.name === name);
    if (hit) return hit;
    const totalPages = parseInt(r.data.totalPages, 10) || 1;
    if (page >= totalPages || list.length === 0) break;
  }
  return null;
}

// The tenant's "Connector" enrollment certificate (needed for connector groups and keys)
async function connectorCertId(mgmtBase, headers) {
  const cr = await axios.get(ENROLLMENT_CERT_URL(mgmtBase), { headers, params: { search: 'Connector' }, timeout: 10000 });
  const certs = cr.data.list || cr.data.enrollmentCerts || (Array.isArray(cr.data) ? cr.data : []);
  const cert = certs.find(c => (c.name || '').toLowerCase() === 'connector') || certs.find(c => /connector/i.test(c.name || ''));
  if (!cert) throw new Error('No "Connector" enrollment certificate found in this ZPA tenant');
  return cert.id;
}

const TRAFFIC_GROUP = 'ZPA Shield Traffic Connectors';
const TRAFFIC_KEY = 'ZPA Shield Traffic Connector key';

// POST /api/zpa/traffic-connector — connector group + provisioning key for an ordinary
// (traffic-forwarding) App Connector, and point the test apps' server group at it so the
// App Scanner group stays dedicated to scanning. Re-running reuses what exists.
router.post('/traffic-connector', async (req, res) => {
  let stage = 'connecting to ZPA';
  try {
    const { headers, mgmtBase: base } = await getClient(req.body);
    const steps = [];

    stage = 'creating the connector group';
    const certId = await connectorCertId(base, headers);
    let group = await findByName(base, headers, 'appConnectorGroup', TRAFFIC_GROUP);
    if (!group) {
      group = (await axios.post(`${base}/appConnectorGroup`, {
        name: TRAFFIC_GROUP, enrollmentCertId: certId, enabled: true,
        description: 'Forwards user traffic to the ZPA Shield test apps - created by ZPA Shield Deployer',
        latitude: '37.3382', longitude: '-121.8863', location: 'San Jose, CA',
        upgradeDay: 'SUNDAY', upgradeTimeInSecs: '66600',
        overrideVersionProfile: true, versionProfileId: '0', dnsQueryType: 'IPV4_IPV6',
      }, { headers, timeout: 15000 })).data;
      steps.push(`Created connector group "${TRAFFIC_GROUP}"`);
    } else steps.push(`Using existing connector group "${TRAFFIC_GROUP}"`);

    stage = 'creating the provisioning key';
    const keysPath = 'associationType/CONNECTOR_GRP/provisioningKey';
    let key = await findByName(base, headers, keysPath, TRAFFIC_KEY);
    if (!key || !key.provisioningKey) {
      key = (await axios.post(`${base}/${keysPath}`, {
        name: key ? `${TRAFFIC_KEY} ${Date.now()}` : TRAFFIC_KEY, maxUsage: '10',
        appConnectorGroupId: group.id, enrollmentCertId: certId, zcomponentId: group.id,
      }, { headers, timeout: 15000 })).data;
      steps.push('Created a provisioning key for it');
    } else steps.push('Using its existing provisioning key');

    stage = 'pointing the test apps at the new connector group';
    const srv = await findByName(base, headers, 'serverGroup', TEST_SERVER_GROUP);
    if (srv) {
      const full = (await axios.get(`${base}/serverGroup/${srv.id}`, { headers, timeout: 15000 })).data;
      if (!(full.appConnectorGroups || []).some(g => g.id === group.id) || (full.appConnectorGroups || []).length !== 1) {
        await axios.put(`${base}/serverGroup/${srv.id}`, { ...full, appConnectorGroups: [{ id: group.id }] }, { headers, timeout: 15000 });
        steps.push(`Server group "${TEST_SERVER_GROUP}" now uses "${TRAFFIC_GROUP}"`);
      }
    }

    res.json({ groupId: group.id, provisioningKey: key.provisioningKey, steps });
  } catch (err) {
    console.error('[traffic-connector error]', stage, err.response?.status, JSON.stringify(err.response?.data));
    res.status(400).json({ error: `Failed while ${stage}: ${zpaError(err)}` });
  }
});

const ACCESS_RULE = 'ZPA Shield - allow test apps';

// POST /api/zpa/test-apps-access-rule — access policy rule allowing the test apps' segment group
// (v2 rule format, as in zscaler-sdk-python add_access_rule_v2). Re-running reuses the rule.
router.post('/test-apps-access-rule', async (req, res) => {
  let stage = 'connecting to ZPA';
  try {
    const { headers, mgmtBase: base } = await getClient(req.body);

    stage = 'finding the test apps segment group';
    const sg = await findByName(base, headers, 'segmentGroup', TEST_SEGMENT_GROUP);
    if (!sg) throw new Error(`Segment group "${TEST_SEGMENT_GROUP}" not found — create the test app segments first`);

    stage = 'reading the access policy';
    const policySet = (await axios.get(`${base}/policySet/policyType/ACCESS_POLICY`, { headers, timeout: 15000 })).data;
    const existing = await findByName(base, headers, 'policySet/rules/policyType/ACCESS_POLICY', ACCESS_RULE);
    if (existing) return res.json({ ruleId: existing.id, steps: [`Access rule "${ACCESS_RULE}" already exists`] });

    stage = 'creating the access rule';
    const v2 = base.replace('/mgmtconfig/v1/', '/mgmtconfig/v2/');
    const rule = (await axios.post(`${v2}/policySet/${policySet.id}/rule`, {
      name: ACCESS_RULE,
      description: 'Lets users reach DVWA and Juice Shop through ZPA - created by ZPA Shield Deployer',
      action: 'ALLOW',
      conditions: [{ operands: [{ objectType: 'APP_GROUP', values: [sg.id] }] }],
    }, { headers, timeout: 15000 })).data;
    res.json({ ruleId: rule.id, steps: [`Created access rule "${ACCESS_RULE}" for segment group "${TEST_SEGMENT_GROUP}"`] });
  } catch (err) {
    console.error('[access-rule error]', stage, err.response?.status, JSON.stringify(err.response?.data));
    res.status(400).json({ error: `Failed while ${stage}: ${zpaError(err)}` });
  }
});

router.post('/test-app-segments', async (req, res) => {
  const { ip, connectorGroupId } = req.body;
  let stage = 'connecting to ZPA';
  try {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(String(ip || ''))) throw new Error('A valid test apps IP address is required');
    if (!connectorGroupId) throw new Error('Choose the App Connector group that will reach the test apps');
    const { headers, mgmtBase: base } = await getClient(req.body);
    const steps = [];

    stage = 'creating the segment group';
    let sg = await findByName(base, headers, 'segmentGroup', TEST_SEGMENT_GROUP);
    if (!sg) { sg = (await axios.post(`${base}/segmentGroup`, { name: TEST_SEGMENT_GROUP, enabled: true }, { headers })).data; steps.push(`Created segment group "${TEST_SEGMENT_GROUP}"`); }
    else steps.push(`Using existing segment group "${TEST_SEGMENT_GROUP}"`);

    stage = 'creating the server group';
    let srv = await findByName(base, headers, 'serverGroup', TEST_SERVER_GROUP);
    if (!srv) {
      srv = (await axios.post(`${base}/serverGroup`, {
        name: TEST_SERVER_GROUP, enabled: true, dynamicDiscovery: true,
        appConnectorGroups: [{ id: connectorGroupId }],
      }, { headers })).data;
      steps.push(`Created server group "${TEST_SERVER_GROUP}"`);
    } else steps.push(`Using existing server group "${TEST_SERVER_GROUP}"`);

    const segments = [];
    for (const app of TEST_APPS) {
      stage = `creating the ${app.name} app segment`;
      const existing = await findByName(base, headers, 'application', app.name);
      if (existing) { segments.push(existing); steps.push(`"${app.name}" already exists — left unchanged`); continue; }
      const r = await axios.post(`${base}/application`, {
        name: app.name,
        description: 'Test app deployed by ZPA Shield Deployer',
        enabled: true,
        domainNames: [ip],
        tcpPortRanges: [String(app.port), String(app.port)],   // legacy format: [from, to] pairs as strings
        segmentGroupId: sg.id,
        serverGroups: [{ id: srv.id }],
        bypassType: 'NEVER',
        healthReporting: 'ON_ACCESS',
        healthCheckType: 'DEFAULT',
      }, { headers });
      segments.push(r.data);
      steps.push(`Created app segment "${app.name}" → ${ip}:${app.port}`);
    }
    res.json({ segments: segments.map(s => ({ id: s.id, name: s.name, domainNames: s.domainNames })), steps });
  } catch (err) {
    console.error('[test-app-segments error]', stage, err.response?.status, JSON.stringify(err.response?.data));
    res.status(400).json({ error: `Failed while ${stage}: ${zpaError(err)}` });
  }
});

// ─── Provisioning / Setup routes ─────────────────────────────────────────────
// For OneAPI: api.zsapi.net/zpa/mgmtconfig/v1/admin/customers/{id}/...
// For legacy: {tenantUrl}/mgmtconfig/v1/admin/customers/{id}/...

router.get('/connector-groups', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId } = req.query;
  try {
    const { headers, mgmtBase } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId });
    const url = mgmtBase + '/appConnectorGroup';
    console.log('[connector-groups GET]', url);
    const r = await axios.get(url, { headers, timeout: 10000 });
    const list = r.data.list || r.data.appConnectorGroups || (Array.isArray(r.data) ? r.data : []);
    res.json(list);
  } catch (err) {
    console.error('[connector-groups GET error]', err.response?.status, err.config?.url, JSON.stringify(err.response?.data));
    res.status(400).json({ error: zpaError(err), url: err.config?.url });
  }
});

// GET /api/zpa/app-segments — list app segments (for the scan step)
router.get('/app-segments', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId } = req.query;
  try {
    const { headers, mgmtBase } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId });
    const r = await axios.get(mgmtBase + '/application', { headers, params: { pagesize: 500 }, timeout: 15000 });
    res.json(r.data.list || r.data.applications || (Array.isArray(r.data) ? r.data : []));
  } catch (err) { res.status(400).json({ error: zpaError(err) }); }
});

router.get('/server-groups', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId } = req.query;
  try {
    const { headers, mgmtBase } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId });
    const r = await axios.get(mgmtBase + '/serverGroup', { headers, timeout: 10000 });
    const list = r.data.list || r.data.serverGroups || (Array.isArray(r.data) ? r.data : []);
    res.json(list);
  } catch (err) { res.status(400).json({ error: zpaError(err) }); }
});

router.get('/enrollment-certs', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId } = req.query;
  try {
    const { headers, mgmtBase } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId });
    const r = await axios.get(ENROLLMENT_CERT_URL(mgmtBase), { headers, timeout: 10000 });
    const list = r.data.list || r.data.enrollmentCerts || (Array.isArray(r.data) ? r.data : []);
    res.json(list);
  } catch (err) { res.status(400).json({ error: zpaError(err) }); }
});

router.get('/provisioning-keys', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId } = req.query;
  try {
    const { headers, mgmtBase } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId });
    const r = await axios.get(mgmtBase + '/associationType/CONNECTOR_GRP/provisioningKey', { headers, timeout: 10000 });
    const list = r.data.list || (Array.isArray(r.data) ? r.data : []);
    res.json(list);
  } catch (err) { res.status(400).json({ error: zpaError(err) }); }
});

router.post('/provisioning-keys', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain,
    customerId, name, maxUsage, connectorGroupId, enrollmentCertId } = req.body;
  try {
    const { headers, mgmtBase } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId });
    const url = mgmtBase + '/associationType/CONNECTOR_GRP/provisioningKey';
    console.log('[provisioning-keys POST]', url);
    const r = await axios.post(url, {
      name, maxUsage: maxUsage || '10',
      appConnectorGroupId: connectorGroupId,
      enrollmentCertId, zcomponentId: connectorGroupId,
    }, { headers, timeout: 15000 });
    res.json(r.data);
  } catch (err) {
    res.status(400).json({ error: zpaError(err), url: err.config?.url, raw: err.response?.data });
  }
});

router.post('/connector-groups', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain,
    customerId, name, description, latitude, longitude, location } = req.body;
  try {
    const { headers, mgmtBase } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId });
    const url = mgmtBase + '/appConnectorGroup';
    console.log('[connector-groups POST]', url, 'name:', name);

    // ZPA requires the "Connector" enrollment (signing) cert on the group.
    // Use the one the UI sent, otherwise look it up (same as zscaler-sdk-python).
    let enrollmentCertId = req.body.enrollmentCertId;
    if (!enrollmentCertId) {
      const cr = await axios.get(ENROLLMENT_CERT_URL(mgmtBase), { headers, params: { search: 'Connector' }, timeout: 10000 });
      const certs = cr.data.list || cr.data.enrollmentCerts || (Array.isArray(cr.data) ? cr.data : []);
      const cert = certs.find(c => (c.name || '').toLowerCase() === 'connector') || certs.find(c => /connector/i.test(c.name || ''));
      if (!cert) throw new Error('No "Connector" enrollment certificate found in this ZPA tenant — cannot create a connector group.');
      enrollmentCertId = cert.id;
    }

    const r = await axios.post(url, {
      name,
      enrollmentCertId,
      description: description || 'App Scanner connector group - created by ZPA Shield Deployer',
      latitude: latitude || '37.3382', longitude: longitude || '-121.8863',
      location: location || 'San Jose, CA',
      upgradeDay: 'SUNDAY', upgradeTimeInSecs: '66600',
      overrideVersionProfile: true, versionProfileId: '0', dnsQueryType: 'IPV4_IPV6',
    }, { headers, timeout: 15000 });
    res.json(r.data);
  } catch (err) {
    console.error('[connector-groups POST error]', err.response?.status, err.config?.url, JSON.stringify(err.response?.data));
    res.status(400).json({ error: zpaError(err), url: err.config?.url, raw: err.response?.data });
  }
});

router.get('/customer', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain } = req.query;
  try {
    if (authMode === 'oneapi') {
      // OneAPI cannot look the ZPA customer ID up; the user has to enter it.
      return res.status(404).json({ error: 'Enter your numeric ZPA Customer ID (ZPA console > Configuration & Control > Public API > API Keys).' });
    }
    const { headers, base } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain });
    const r = await axios.get(base + '/tenant', { headers, timeout: 8000 });
    res.json({ id: r.data.id || r.data.customerId, raw: r.data });
  } catch (err) {
    res.status(404).json({ error: 'Could not determine customerId: ' + err.message });
  }
});

// GET /api/zpa/debug-token — decode JWT claims (no verification) to diagnose scope issues
router.get('/debug-token', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain } = req.query;
  try {
    if (authMode !== 'oneapi') return res.json({ note: 'Only relevant for OneAPI mode' });
    const token = await getOneApiToken(clientId, clientSecret, vanityDomain);
    // Decode JWT payload (base64url, no verification)
    const parts = token.split('.');
    if (parts.length !== 3) return res.status(400).json({ error: 'Not a JWT' });
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString());
    // Don't log the full token, just the claims
    res.json({
      sub: payload.sub,
      aud: payload.aud,
      scp: payload.scp || payload.scope,
      iss: payload.iss,
      exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
      roles: payload.roles || payload['zscaler.roles'] || payload.groups,
      allClaims: Object.keys(payload),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
