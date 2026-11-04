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
async function getOneApiToken(clientId, clientSecret, cloudEnv) {
  // Token endpoint is on the same cloud domain as the API
  const envTokenMap = {
    'zscaler.com':        'https://api.zscaler.com/oauth2/v1/token',
    'zscalertwo.net':     'https://api.zscalertwo.net/oauth2/v1/token',
    'zscalerthree.net':   'https://api.zscalerthree.net/oauth2/v1/token',
    'zscloud.net':        'https://api.zscloud.net/oauth2/v1/token',
    'zscalerone.net':     'https://api.zscalerone.net/oauth2/v1/token',
    'zscalerbeta.net':    'https://api.zscalerbeta.net/oauth2/v1/token',
  }
  const tokenUrl = envTokenMap[cloudEnv] || 'https://api.zscaler.com/oauth2/v1/token'
  const res = await axios.post(tokenUrl,
    new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
  )
  return res.data.access_token
}

/**
 * Returns { headers, base } ready to make ZPA API calls.
 * authMode: 'apikey' | 'oauth' | 'oneapi'
 */
async function getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv }) {
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
      const token = await getOneApiToken(clientId, clientSecret, cloudEnv);
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
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv } = req.query;
  try {
    const { headers, base } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv });

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
    const detail = err.response?.data?.message || err.response?.data?.error || err.message;
    res.status(400).json({ valid: false, error: detail });
  }
});

// POST /api/zpa/scan
router.post('/scan', async (req, res) => {
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv,
    appSegmentIds, probingLevel, frequency, startTime, scanName, scannerConnectorId } = req.body;
  try {
    const { headers, base } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv });

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
  const { authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv, serverGroupId, apps } = req.body;
  try {
    const { headers, base } = await getClient({ authMode, tenantUrl, apiKey, clientId, clientSecret, cloudEnv });
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
