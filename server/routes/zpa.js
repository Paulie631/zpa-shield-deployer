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
async function getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain }) {
  switch (authMode) {
    case 'apikey': {
      return {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        base: `https://${tenantUrl}/api/v1`
      };
    }
    case 'oauth': {
      const token = await getTenantToken(tenantUrl, clientId, clientSecret);
      return {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        base: `https://${tenantUrl}/api/v1`
      };
    }
    case 'oneapi': {
      const token = await getOneApiToken(clientId, clientSecret, vanityDomain);
      // OneAPI base varies by cloud env — default to zscaler.com
      const envMap = {
        'zscaler.com':   'https://api.zscaler.com/zpa/v1',
        'zscalertwo.net':'https://api.zscalertwo.net/zpa/v1',
        'zscalerthree.net':'https://api.zscalerthree.net/zpa/v1',
        'zscloud.net':   'https://api.zscloud.net/zpa/v1',
        'zscalerbeta.net':'https://api.zscalerbeta.net/zpa/v1',
        'zscalerone.net':'https://api.zscalerone.net/zpa/v1',
      };
      const base = envMap[cloudEnv] || 'https://api.zscaler.com/zpa/v1';
      return {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        base
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
    const { headers, base } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain });

    const [cgRes, asRes] = await Promise.allSettled([
      axios.get(`${base}/appConnectorGroup`, { headers, timeout: 10000 }),
      axios.get(`${base}/application`, { headers, timeout: 10000 })
    ]);

    // OneAPI may use different pagination shape — handle both
    const parseList = (r) => {
      if (r.status !== 'fulfilled') return [];
      const d = r.value.data;
      return d.list || d.appConnectorGroups || d.applications || d || [];
    };

    res.json({
      valid: true,
      authMode,
      base,
      connectorGroups: parseList(cgRes),
      appSegments: parseList(asRes)
    });
  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.data?.message || err.response?.data?.error_description || err.response?.data?.error || err.message;
    const url = err.config?.url || '';
    console.error('[ZPA validate]', status, url, detail, err.response?.data);
    res.status(400).json({ valid: false, error: detail, httpStatus: status, requestUrl: url, raw: err.response?.data });
  }
});

// POST /api/zpa/scan
router.post('/scan', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain,
    appSegmentIds, probingLevel, frequency, startTime, scanName, scannerConnectorId } = req.body;
  try {
    const { headers, base } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain });

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
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, serverGroupId, apps } = req.body;
  try {
    const { headers, base } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain });
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

module.exports = router;


// ─── Provisioning / Setup routes ─────────────────────────────────────────────

// Helper: build mgmtconfig base
// mgmtconfig ALWAYS lives at config.private.zscaler.com regardless of auth mode
// OneAPI token is accepted there too
function mgmtBase(base, customerId) {
  if (!customerId) return base; // fallback: use validate-style base (works for some list endpoints)
  // Determine the mgmtconfig host from the base URL
  // Legacy:  https://{tenant}.private.zscaler.com/api/v1  -> https://{tenant}.private.zscaler.com/mgmtconfig/v1/admin/customers/{id}
  // OneAPI:  https://api.zscaler.com/zpa/v1               -> https://config.private.zscaler.com/mgmtconfig/v1/admin/customers/{id}
  // (OneAPI Bearer tokens are accepted by config.private.zscaler.com)
  const envHostMap = {
    'api.zscaler.com':        'config.private.zscaler.com',
    'api.zscalertwo.net':     'config.zpatwo.net',
    'api.zscalerthree.net':   'config.zpathree.net',
    'api.zscloud.net':        'config.zscloud.net',
    'api.zscalerone.net':     'config.zscalerone.net',
    'api.zscalerbeta.net':    'config.zpabeta.net',
    'api.zscalergov.net':     'config.zpagov.net',
  };
  let configHost = 'config.private.zscaler.com'; // default
  for (const [apiHost, cfgHost] of Object.entries(envHostMap)) {
    if (base.includes(apiHost)) { configHost = cfgHost; break; }
  }
  // If base is already a legacy tenant URL (e.g. acme.private.zscaler.com), use it directly
  if (!base.includes('api.zscaler') && !base.includes('api.zscloud') && !base.includes('api.zscalerone')) {
    const legacyHost = base.replace(/^https:\/\//, '').split('/')[0];
    configHost = legacyHost;
  }
  return `https://${configHost}/mgmtconfig/v1/admin/customers/${customerId}`;
}

// GET /api/zpa/customer — get customer/tenant info (for customerId)
router.get('/customer', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain } = req.query;
  try {
    const { headers, base } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain });
    // Try several paths to find the customer/tenant ID
    const paths = [
      `${base}/tenant`,
      `${base}/customers`,
      `${base.replace('/zpa/v1','')}/zpa/mgmtconfig/v1/admin/customers`,
      `${base.replace('/api/v1','')}/api/v1/customers`,
    ];
    for (const url of paths) {
      try {
        const r = await axios.get(url, { headers, timeout: 8000 });
        const d = r.data;
        // customerId might be top-level or in a list
        const id = d.id || d.customerId || (Array.isArray(d) && d[0]?.id) || d.list?.[0]?.id;
        if (id) return res.json({ id, raw: d });
      } catch { /* try next */ }
    }
    res.status(404).json({ error: 'Could not determine customerId — you may need to enter it manually' });
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.message || err.message });
  }
});

// GET /api/zpa/connector-groups — list app connector groups
router.get('/connector-groups', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId } = req.query;
  try {
    const { headers, base } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain });
    const mb = mgmtBase(base, customerId);
    const r = await axios.get(`${mb}/appConnectorGroup`, { headers, timeout: 10000 });
    const list = r.data.list || r.data.appConnectorGroups || r.data || [];
    res.json(list);
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.message || err.message });
  }
});

// GET /api/zpa/server-groups — list server groups
router.get('/server-groups', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId } = req.query;
  try {
    const { headers, base } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain });
    const mb = mgmtBase(base, customerId);
    const r = await axios.get(`${mb}/serverGroup`, { headers, timeout: 10000 });
    const list = r.data.list || r.data.serverGroups || r.data || [];
    res.json(list);
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.message || err.message });
  }
});

// GET /api/zpa/enrollment-certs — list enrollment certs
router.get('/enrollment-certs', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId } = req.query;
  try {
    const { headers, base } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain });
    const mb = mgmtBase(base, customerId);
    const r = await axios.get(`${mb}/enrollmentCert`, { headers, timeout: 10000 });
    const list = r.data.list || r.data.enrollmentCerts || r.data || [];
    res.json(list);
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.message || err.message });
  }
});

// GET /api/zpa/provisioning-keys — list existing provisioning keys
router.get('/provisioning-keys', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain, customerId } = req.query;
  try {
    const { headers, base } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain });
    const mb = mgmtBase(base, customerId);
    const r = await axios.get(`${mb}/associationType/CONNECTOR_GRP/provisioningKey`, { headers, timeout: 10000 });
    const list = r.data.list || r.data || [];
    res.json(list);
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.message || err.message });
  }
});

// POST /api/zpa/provisioning-keys — create a new provisioning key
router.post('/provisioning-keys', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain,
    customerId, name, maxUsage, connectorGroupId, enrollmentCertId } = req.body;
  try {
    const { headers, base } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain });
    const mb = mgmtBase(base, customerId);
    const r = await axios.post(`${mb}/associationType/CONNECTOR_GRP/provisioningKey`, {
      name,
      maxUsage: maxUsage || '10',
      appConnectorGroupId: connectorGroupId,
      enrollmentCertId,
      zcomponentId: connectorGroupId,
    }, { headers, timeout: 15000 });
    res.json(r.data);
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.message || err.message, raw: err.response?.data });
  }
});

// POST /api/zpa/connector-groups — create a new connector group
router.post('/connector-groups', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain,
    customerId, name, description, latitude, longitude, location } = req.body;
  try {
    const { headers, base } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, vanityDomain });
    const mb = mgmtBase(base, customerId);
    const r = await axios.post(`${mb}/appConnectorGroup`, {
      name,
      description: description || 'App Scanner connector group — created by ZPA Shield Deployer',
      latitude: latitude || '37.3382',
      longitude: longitude || '-121.8863',
      location: location || 'San Jose, CA',
      upgradeDay: 'SUNDAY',
      upgradeTimeInSecs: '66600',
      overrideVersionProfile: true,
      versionProfileId: '0',
      dnsQueryType: 'IPV4_IPV6',
    }, { headers, timeout: 15000 });
    res.json(r.data);
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.message || err.message, raw: err.response?.data });
  }
});

