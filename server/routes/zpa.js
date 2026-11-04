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

/**
 * Returns { headers, base } ready to make ZPA API calls.
 * authMode: 'apikey' | 'oauth' | 'oneapi'
 */
async function getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId }) {
  // OneAPI gateway host (confirmed from zscaler-sdk-python RequestExecutor.BASE_URL)
  const ONEAPI_GATEWAY = {
    'zscaler.com':    'https://api.zsapi.net',
    'zscalertwo.net': 'https://api.zsapi.net',    // same gateway for commercial clouds
    'zscalerthree.net':'https://api.zsapi.net',
    'zscloud.net':    'https://api.zsapi.net',
    'zscalerbeta.net':'https://api.zsapi.net',
    'zscalerone.net': 'https://api.zsapi.net',
    'zscalergov.net': 'https://api.zscalergov.net',
    'zscalergov.us':  'https://api.zscalergov.us',
  };
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
      const token = await getOneApiToken(clientId, clientSecret, vanityDomain);
      if (!token) throw new Error('OneAPI token was empty/undefined');
      const gwHost = ONEAPI_GATEWAY[cloudEnv] || 'https://api.zsapi.net';
      console.log('[getClient oneapi] gateway:', gwHost, 'customerId:', customerId, 'token:', token.slice(0, 20) + '...');
      return {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        // base = legacy validate/scan endpoint (still needed for appProtection scan routes)
        base: gwHost + '/zpa/mgmtconfig/v1/admin/customers/' + (customerId || ''),
        // mgmtBase = full mgmtconfig path for CRUD
        mgmtBase: gwHost + '/zpa/mgmtconfig/v1/admin/customers/' + (customerId || ''),
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
    let headers, base, mgmtBase;
    // For OneAPI, we need to discover customerId first via /zpa/mgmtconfig/v1/admin/customers
    if (authMode === 'oneapi') {
      const ONEAPI_GATEWAY = {
        'zscaler.com': 'https://api.zsapi.net',
        'zscalertwo.net': 'https://api.zsapi.net',
        'zscalerthree.net': 'https://api.zsapi.net',
        'zscloud.net': 'https://api.zsapi.net',
        'zscalerbeta.net': 'https://api.zsapi.net',
        'zscalerone.net': 'https://api.zsapi.net',
        'zscalergov.net': 'https://api.zscalergov.net',
        'zscalergov.us': 'https://api.zscalergov.us',
      };
      const token = await getOneApiToken(clientId, clientSecret, vanityDomain);
      if (!token) throw new Error('Failed to obtain OneAPI token');
      headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const gwHost = ONEAPI_GATEWAY[cloudEnv] || 'https://api.zsapi.net';
      // Discover customer(s) for this token
      const custRes = await axios.get(gwHost + '/zpa/mgmtconfig/v1/admin/customers', { headers, timeout: 10000 })
        .catch(() => null);
      let customerId = null;
      if (custRes?.data) {
        const custList = custRes.data.list || custRes.data.customers || custRes.data || [];
        const first = Array.isArray(custList) ? custList[0] : custList;
        customerId = first?.id || first?.customerId || null;
        console.log('[validate] discovered customerId:', customerId, 'from', gwHost + '/zpa/mgmtconfig/v1/admin/customers');
      }
      base = customerId
        ? gwHost + '/zpa/mgmtconfig/v1/admin/customers/' + customerId
        : gwHost + '/zpa/mgmtconfig/v1/admin/customers';
      mgmtBase = base;
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
    res.status(401).json({ valid: false, error: err.response?.data?.message || err.message });
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
    res.status(400).json({ error: err.response?.data?.message || err.message });
  }
});

// POST /api/zpa/app-segments
router.post('/app-segments', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, serverGroupId, apps, customerId } = req.body;
  try {
    const { headers, mgmtBase: base } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId });
    const created = [];
    for (const app of apps) {
      const r = await axios.post(`${base}/application`, {
        name: app.name,
        domainNames: [app.domain],
        tcpPortRanges: [{ from: String(app.port), to: String(app.port) }],
        serverGroups: [{ id: serverGroupId }],
        enabled: true
      }, { headers });
      created.push({ name: app.name, id: r.data.id, domain: app.domain });
    }
    res.json({ created });
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.message || err.message });
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
    res.status(400).json({ error: err.response?.data?.message || err.message, url: err.config?.url });
  }
});

router.get('/server-groups', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId } = req.query;
  try {
    const { headers, mgmtBase } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId });
    const r = await axios.get(mgmtBase + '/serverGroup', { headers, timeout: 10000 });
    const list = r.data.list || r.data.serverGroups || (Array.isArray(r.data) ? r.data : []);
    res.json(list);
  } catch (err) { res.status(400).json({ error: err.response?.data?.message || err.message }); }
});

router.get('/enrollment-certs', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId } = req.query;
  try {
    const { headers, mgmtBase } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId });
    const r = await axios.get(mgmtBase + '/enrollmentCert', { headers, timeout: 10000 });
    const list = r.data.list || r.data.enrollmentCerts || (Array.isArray(r.data) ? r.data : []);
    res.json(list);
  } catch (err) { res.status(400).json({ error: err.response?.data?.message || err.message }); }
});

router.get('/provisioning-keys', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId } = req.query;
  try {
    const { headers, mgmtBase } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId });
    const r = await axios.get(mgmtBase + '/associationType/CONNECTOR_GRP/provisioningKey', { headers, timeout: 10000 });
    const list = r.data.list || (Array.isArray(r.data) ? r.data : []);
    res.json(list);
  } catch (err) { res.status(400).json({ error: err.response?.data?.message || err.message }); }
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
    res.status(400).json({ error: err.response?.data?.message || err.message, url: err.config?.url, raw: err.response?.data });
  }
});

router.post('/connector-groups', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain,
    customerId, name, description, latitude, longitude, location } = req.body;
  try {
    const { headers, mgmtBase } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId });
    const url = mgmtBase + '/appConnectorGroup';
    console.log('[connector-groups POST]', url, 'name:', name);
    const r = await axios.post(url, {
      name,
      description: description || 'App Scanner connector group - created by ZPA Shield Deployer',
      latitude: latitude || '37.3382', longitude: longitude || '-121.8863',
      location: location || 'San Jose, CA',
      upgradeDay: 'SUNDAY', upgradeTimeInSecs: '66600',
      overrideVersionProfile: true, versionProfileId: '0', dnsQueryType: 'IPV4_IPV6',
    }, { headers, timeout: 15000 });
    res.json(r.data);
  } catch (err) {
    console.error('[connector-groups POST error]', err.response?.status, err.config?.url, JSON.stringify(err.response?.data));
    res.status(400).json({ error: err.response?.data?.message || err.message, url: err.config?.url, raw: err.response?.data });
  }
});

router.get('/customer', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain } = req.query;
  try {
    if (authMode === 'oneapi') {
      const ONEAPI_GATEWAY = { 'zscaler.com': 'https://api.zsapi.net', 'zscalertwo.net': 'https://api.zsapi.net', 'zscalerthree.net': 'https://api.zsapi.net', 'zscloud.net': 'https://api.zsapi.net', 'zscalerbeta.net': 'https://api.zsapi.net', 'zscalerone.net': 'https://api.zsapi.net', 'zscalergov.net': 'https://api.zscalergov.net', 'zscalergov.us': 'https://api.zscalergov.us' };
      const token = await getOneApiToken(clientId, clientSecret, vanityDomain);
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const gwHost = ONEAPI_GATEWAY[cloudEnv] || 'https://api.zsapi.net';
      const r = await axios.get(gwHost + '/zpa/mgmtconfig/v1/admin/customers', { headers, timeout: 8000 });
      const custList = r.data.list || r.data.customers || r.data || [];
      const first = Array.isArray(custList) ? custList[0] : custList;
      return res.json({ id: first?.id || first?.customerId, raw: r.data });
    }
    const { headers, base } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain });
    const r = await axios.get(base + '/tenant', { headers, timeout: 8000 });
    res.json({ id: r.data.id || r.data.customerId, raw: r.data });
  } catch (err) {
    res.status(404).json({ error: 'Could not determine customerId: ' + err.message });
  }
});

module.exports = router;
