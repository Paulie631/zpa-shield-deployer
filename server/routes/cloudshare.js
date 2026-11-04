const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');

const CS_BASE = 'https://use.cloudshare.com';

// ─── Auth ─────────────────────────────────────────────────────────────────────
// CloudShare API v3: cs_sha1 HMAC auth
// Signature = SHA1(apiKey + fullUrl + timestamp + token)  — plain SHA1, no HMAC key
function csAuth(apiId, apiKey, url) {
  const timestamp = Math.floor(Date.now() / 1000);
  const token = crypto.randomBytes(5).toString('hex'); // 10 alphanumeric chars
  const sig = crypto.createHash('sha1').update(apiKey + url + timestamp + token).digest('hex');
  return `cs_sha1 userapiid:${apiId};timestamp:${timestamp};token:${token};hmac:${sig}`;
}

function csHeaders(apiId, apiKey, path) {
  const url = CS_BASE + path;
  return {
    Authorization: csAuth(apiId, apiKey, url),
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

async function csGet(apiId, apiKey, path) {
  const res = await axios.get(CS_BASE + path, {
    headers: csHeaders(apiId, apiKey, path),
    timeout: 15000,
  });
  return res.data;
}

async function csPost(apiId, apiKey, path, body) {
  const res = await axios.post(CS_BASE + path, body, {
    headers: csHeaders(apiId, apiKey, path),
    timeout: 15000,
  });
  return res.data;
}

async function csPut(apiId, apiKey, path, body = {}) {
  const res = await axios.put(CS_BASE + path, body, {
    headers: csHeaders(apiId, apiKey, path),
    timeout: 15000,
  });
  return res.data;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/cloudshare/validate — test credentials + return environments
router.get('/validate', async (req, res) => {
  const { apiId, apiKey } = req.query;
  try {
    const envs = await csGet(apiId, apiKey, '/api/v3/envs');
    res.json({ valid: true, environments: envs });
  } catch (err) {
    res.status(400).json({ valid: false, error: err.response?.data?.message || err.message });
  }
});

// GET /api/cloudshare/envs — list all environments
router.get('/envs', async (req, res) => {
  const { apiId, apiKey } = req.query;
  try {
    const envs = await csGet(apiId, apiKey, '/api/v3/envs');
    res.json(envs);
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.message || err.message });
  }
});

// GET /api/cloudshare/envs/:envId — environment details + VMs
router.get('/envs/:envId', async (req, res) => {
  const { apiId, apiKey } = req.query;
  const { envId } = req.params;
  try {
    const detail = await csGet(apiId, apiKey, `/api/v3/envs/actions/getextended?envId=${envId}`);
    res.json(detail);
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.message || err.message });
  }
});

// GET /api/cloudshare/policies
router.get('/policies', async (req, res) => {
  const { apiId, apiKey, projectId } = req.query;
  try {
    const policies = await csGet(apiId, apiKey, `/api/v3/projects/${projectId}/policies`);
    res.json(policies);
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.message || err.message });
  }
});

// GET /api/cloudshare/blueprints — list blueprints for a project
router.get('/blueprints', async (req, res) => {
  const { apiId, apiKey, projectId } = req.query;
  try {
    const bps = await csGet(apiId, apiKey, `/api/v3/projects/${projectId}/blueprints`);
    res.json(bps);
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.message || err.message });
  }
});

// GET /api/cloudshare/regions
router.get('/regions', async (req, res) => {
  const { apiId, apiKey } = req.query;
  try {
    const regions = await csGet(apiId, apiKey, '/api/v3/regions');
    res.json(regions);
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.message || err.message });
  }
});

// POST /api/cloudshare/envs — create environment from blueprint
router.post('/envs', async (req, res) => {
  const { apiId, apiKey, projectId, policyId, blueprintId, regionId, envName, description } = req.body;
  try {
    const body = {
      environment: {
        projectId,
        policyId,
        regionId: regionId || undefined,
        name: envName || 'ZPA App Scanner',
        description: description || 'Created by ZPA Shield Deployer',
      },
      itemsCart: [{ type: 1, blueprintId }],
    };
    const result = await csPost(apiId, apiKey, '/api/v3/envs', body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.message || err.message });
  }
});

// PUT /api/cloudshare/envs/:envId/resume
router.put('/envs/:envId/resume', async (req, res) => {
  const { apiId, apiKey } = req.body;
  const { envId } = req.params;
  try {
    const result = await csPut(apiId, apiKey, `/api/v3/envs/actions/resume?envId=${envId}`);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.message || err.message });
  }
});

// PUT /api/cloudshare/envs/:envId/suspend
router.put('/envs/:envId/suspend', async (req, res) => {
  const { apiId, apiKey } = req.body;
  const { envId } = req.params;
  try {
    const result = await csPut(apiId, apiKey, `/api/v3/envs/actions/suspend?envId=${envId}&immediate=true`);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.message || err.message });
  }
});

// POST /api/cloudshare/vms/:vmId/execute — run a command on a VM
router.post('/vms/:vmId/execute', async (req, res) => {
  const { apiId, apiKey, command } = req.body;
  const { vmId } = req.params;
  try {
    const result = await csPost(apiId, apiKey, '/api/v3/vms/actions/executepath', {
      vmId,
      path: command,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.message || err.message });
  }
});

// GET /api/cloudshare/vms/:vmId/execute/:execId — check execution status
router.get('/vms/:vmId/execute/:execId', async (req, res) => {
  const { apiId, apiKey } = req.query;
  const { vmId, execId } = req.params;
  try {
    const result = await csGet(apiId, apiKey, `/api/v3/vms/actions/checkexecutionstatus?vmId=${vmId}&executionId=${execId}`);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.response?.data?.message || err.message });
  }
});

module.exports = router;
