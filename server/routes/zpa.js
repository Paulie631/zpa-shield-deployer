const express = require('express');
const router = express.Router();
const axios = require('axios');

function getAuthHeader(query) {
  if (query.apiKey) return { Authorization: `Bearer ${query.apiKey}` };
  return {}; // OAuth token fetched separately
}

async function getToken(tenantUrl, clientId, clientSecret) {
  const res = await axios.post(`https://${tenantUrl}/oauth/token`, null, {
    params: { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }
  });
  return res.data.access_token;
}

// GET /api/zpa/validate
router.get('/validate', async (req, res) => {
  const { tenantUrl, apiKey, clientId, clientSecret } = req.query;
  try {
    let headers;
    if (apiKey) {
      headers = { Authorization: `Bearer ${apiKey}` };
    } else {
      const token = await getToken(tenantUrl, clientId, clientSecret);
      headers = { Authorization: `Bearer ${token}` };
    }

    const base = `https://${tenantUrl}/api/v1`;

    const [cgRes, asRes] = await Promise.all([
      axios.get(`${base}/appConnectorGroup`, { headers }),
      axios.get(`${base}/application`, { headers })
    ]);

    res.json({
      valid: true,
      connectorGroups: cgRes.data.list || cgRes.data || [],
      appSegments: asRes.data.list || asRes.data || []
    });
  } catch (err) {
    res.status(400).json({ valid: false, error: err.response?.data?.message || err.message });
  }
});

// POST /api/zpa/scan — create scan profile + scan
router.post('/scan', async (req, res) => {
  const { tenantUrl, apiKey, clientId, clientSecret, appSegmentIds, probingLevel, frequency, startTime, scanName, scannerConnectorId } = req.body;
  try {
    let headers;
    if (apiKey) {
      headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    } else {
      const token = await getToken(tenantUrl, clientId, clientSecret);
      headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    }

    const base = `https://${tenantUrl}/api/v1`;

    // Create scan profile
    const profileRes = await axios.post(`${base}/appProtection/scanProfile`, {
      name: `${scanName} Profile`,
      probingLevel: probingLevel.toUpperCase(),
      frequency: frequency.toUpperCase(),
      startTime
    }, { headers });

    const scanProfileId = profileRes.data.id;

    // Create scan
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

// POST /api/zpa/app-segments — create app segments for test apps
router.post('/app-segments', async (req, res) => {
  const { tenantUrl, apiKey, clientId, clientSecret, serverGroupId, apps } = req.body;
  // apps: [{ name, domain, port }]
  try {
    let headers;
    if (apiKey) {
      headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
    } else {
      const token = await getToken(tenantUrl, clientId, clientSecret);
      headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    }

    const base = `https://${tenantUrl}/api/v1`;
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
