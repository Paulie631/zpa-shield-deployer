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

// Get a legacy ZPA token via config.{zpaCloud}/signin (used by config.zpatwo.net etc.)
async function getZpaLegacyToken(clientId, clientSecret, zpaHost) {
  const signinUrl = zpaHost + '/signin';
  console.log('[getZpaLegacyToken] POST', signinUrl);
  const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret });
  const r = await axios.post(signinUrl, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    timeout: 10000,
  });
  const token = r.data.token || r.data.access_token || r.data.Bearer;
  if (!token) throw new Error('ZPA signin returned no token: ' + JSON.stringify(r.data));
  console.log('[getZpaLegacyToken] got token prefix:', token.slice(0, 20) + '...');
  return token;
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

      // Auto-detect ZPA host from token audience claims
      // Token aud array contains entries like ZPA.zpatwo.net or ZPA.private.zscaler.com
      // Map: ZPA.zpatwo.net -> config.zpatwo.net (legacy mgmtconfig host for that cloud)
      let zpaHost = null;
      try {
        const parts = token.split('.');
        const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString());
        const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
        const zpaAud = audList.find(a => a && a.startsWith('ZPA.'));
        if (zpaAud) {
          zpaHost = 'https://' + zpaAud.replace('ZPA.', 'config.');
          console.log('[getClient oneapi] detected ZPA host from token aud:', zpaHost);
        }
      } catch(e) { /* ignore decode errors */ }

      // Fallback: use cloudEnv mapping
      if (!zpaHost) {
        const zpaHostMap = {
          'zscaler.com':     'https://config.private.zscaler.com',
          'zscalertwo.net':  'https://config.zpatwo.net',
          'zscalerthree.net':'https://config.zpathree.net',
          'zscloud.net':     'https://config.zscloud.net',
          'zscalerbeta.net': 'https://config.zpabeta.net',
          'zscalerone.net':  'https://config.zpaone.net',
        };
        zpaHost = zpaHostMap[cloudEnv] || 'https://config.private.zscaler.com';
        console.log('[getClient oneapi] fallback ZPA host from cloudEnv:', zpaHost);
      }

      // Also compute OneAPI gateway for any non-ZPA-mgmtconfig calls
      const gwHost = ONEAPI_GATEWAY[cloudEnv] || 'https://api.zsapi.net';
      console.log('[getClient oneapi] zpaHost:', zpaHost, 'gwHost:', gwHost, 'customerId:', customerId, 'token:', token.slice(0, 20) + '...');

      // config.zpatwo.net (and all ZPA config hosts) require a LEGACY ZPA token from /signin,
      // not a OneAPI Bearer JWT. Get a legacy token using the same client credentials.
      let mgmtHeaders;
      try {
        const legacyToken = await getZpaLegacyToken(clientId, clientSecret, zpaHost);
        mgmtHeaders = { Authorization: `Bearer ${legacyToken}`, 'Content-Type': 'application/json' };
        console.log('[getClient oneapi] using legacy ZPA token for mgmtBase calls');
      } catch (legacyErr) {
        console.warn('[getClient oneapi] legacy ZPA signin failed, falling back to OneAPI token:', legacyErr.message);
        mgmtHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      }

      const mgmtBase = zpaHost + '/zpa/mgmtconfig/v1/admin/customers/' + (customerId || '');
      return {
        headers: mgmtHeaders,        // legacy ZPA token for mgmtconfig calls
        base: mgmtBase,
        mgmtBase,
        zpaHost,
        oneapiHeaders: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
      const ZPA_HOST_MAP = {
        'zscaler.com':     'https://config.private.zscaler.com',
        'zscalertwo.net':  'https://config.zpatwo.net',
        'zscalerthree.net':'https://config.zpathree.net',
        'zscloud.net':     'https://config.zscloud.net',
        'zscalerbeta.net': 'https://config.zpabeta.net',
        'zscalerone.net':  'https://config.zpaone.net',
      };
      const token = await getOneApiToken(clientId, clientSecret, vanityDomain);
      if (!token) throw new Error('Failed to obtain OneAPI token');
      // Auto-detect ZPA host from token audience
      let zpaHost = ZPA_HOST_MAP[cloudEnv] || 'https://config.private.zscaler.com';
      try {
        const parts = token.split('.');
        const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString());
        const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
        const zpaAud = audList.find(a => a && a.startsWith('ZPA.'));
        if (zpaAud) { zpaHost = 'https://' + zpaAud.replace('ZPA.', 'config.'); }
      } catch(e) {}
      console.log('[validate oneapi] zpaHost:', zpaHost);

      // config.zpatwo.net requires legacy ZPA token, not OneAPI JWT
      let legacyToken;
      try { legacyToken = await getZpaLegacyToken(clientId, clientSecret, zpaHost); } catch(e) {}
      headers = { Authorization: `Bearer ${legacyToken || token}`, 'Content-Type': 'application/json' };
      if (legacyToken) console.log('[validate oneapi] using legacy ZPA token');

      // Discover customer(s) for this token
      const custRes = await axios.get(zpaHost + '/zpa/mgmtconfig/v1/admin/customers', { headers, timeout: 10000 })
        .catch(() => null);
      let customerId = null;
      if (custRes?.data) {
        const custList = custRes.data.list || custRes.data.customers || custRes.data || [];
        const first = Array.isArray(custList) ? custList[0] : custList;
        customerId = first?.id || first?.customerId || null;
        console.log('[validate] discovered customerId:', customerId, 'from', zpaHost + '/zpa/mgmtconfig/v1/admin/customers');
      }
      base = customerId
        ? zpaHost + '/zpa/mgmtconfig/v1/admin/customers/' + customerId
        : zpaHost + '/zpa/mgmtconfig/v1/admin/customers';
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
      const ZPA_HOST_MAP = { 'zscaler.com': 'https://config.private.zscaler.com', 'zscalertwo.net': 'https://config.zpatwo.net', 'zscalerthree.net': 'https://config.zpathree.net', 'zscloud.net': 'https://config.zscloud.net', 'zscalerbeta.net': 'https://config.zpabeta.net', 'zscalerone.net': 'https://config.zpaone.net' };
      const token = await getOneApiToken(clientId, clientSecret, vanityDomain);
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      // Auto-detect ZPA host from token audience
      let zpaHost = ZPA_HOST_MAP[cloudEnv] || 'https://config.private.zscaler.com';
      try {
        const parts = token.split('.');
        const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString());
        const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
        const zpaAud = audList.find(a => a && a.startsWith('ZPA.'));
        if (zpaAud) { zpaHost = 'https://' + zpaAud.replace('ZPA.', 'config.'); }
      } catch(e) {}
      let legacyTok; try { legacyTok = await getZpaLegacyToken(clientId, clientSecret, zpaHost); } catch(e) {}
      const custHeaders = { Authorization: `Bearer ${legacyTok || token}`, 'Content-Type': 'application/json' };
      const r = await axios.get(zpaHost + '/zpa/mgmtconfig/v1/admin/customers', { headers: custHeaders, timeout: 8000 });
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
