const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const { generateSetupScript } = require('../templates/setupScript');
const { generateTestAppsScript } = require('../templates/testAppsScript');

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

// ─── Setup script ─────────────────────────────────────────────────────────────

// POST /api/cloudshare/script — generate the pre-filled setup script
router.post('/script', (req, res) => {
  try {
    res.json({ script: generateSetupScript(req.body) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Adding a VM to an environment ────────────────────────────────────────────

// GET /api/cloudshare/templates — VM templates (optionally for one region)
router.get('/templates', async (req, res) => {
  const { apiId, apiKey, regionId } = req.query;
  try {
    const q = '/api/v3/templates?templateType=1&take=1000' + (regionId ? `&regionId=${encodeURIComponent(regionId)}` : '');
    const list = await csGet(apiId, apiKey, q);
    res.json((Array.isArray(list) ? list : []).map(t => ({
      id: t.id, name: t.name, description: t.description, regionId: t.regionId, resources: t.resources,
    })));
  } catch (err) {
    res.status(400).json({ error: csError(err) });
  }
});

// POST /api/cloudshare/envs/:envId/vms — add a VM from a template to an existing environment
router.post('/envs/:envId/vms', async (req, res) => {
  const { apiId, apiKey, templateVmId, name, description } = req.body;
  const { envId } = req.params;
  try {
    if (!templateVmId) throw new Error('templateVmId is required');
    const result = await csPut(apiId, apiKey, '/api/v3/envs', {
      envId,
      itemsCart: [{ type: 2, name: name || 'ZPA Test Apps', description: description || 'DVWA + Juice Shop — added by ZPA Shield Deployer', templateVmId }],
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: csError(err) });
  }
});

// ─── Running scripts on a VM ──────────────────────────────────────────────────
// CloudShare has no file-upload API, only "run a command" (executePath). So a
// script is sent to the VM in base64 chunks, decoded there, then started in the
// background (these scripts take minutes, longer than one command call can
// wait). Progress is read back from the script's log file.

const JOBS = {
  'zpa-setup':    { done: 'Setup complete!' },
  'zpa-testapps': { done: 'Test apps ready!' },
};
const FAIL_MARKER = 'SCRIPT FAILED';
const CHUNK = 1500;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const csError = (err) => err.response?.data?.message || err.response?.data?.Message || err.message;

// Run one command on the VM and wait for it to finish. Returns its stdout.
async function runOnVm(apiId, apiKey, vmId, command, timeoutMs = 45000) {
  const started = await csPost(apiId, apiKey, '/api/v3/vms/actions/executepath', { vmId, path: command });
  const executionId = started && started.executionId;
  if (!executionId) throw new Error('CloudShare did not return an executionId: ' + JSON.stringify(started));
  const q = `/api/v3/vms/actions/checkexecutionstatus?vmId=${encodeURIComponent(vmId)}&executionId=${encodeURIComponent(executionId)}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(2000);
    const st = await csGet(apiId, apiKey, q);
    if (st && st.success) {
      return { stdout: st.standardOutput || '', stderr: st.standardError || '', raw: st };
    }
  }
  throw new Error(`Timed out waiting for the VM to run: ${command.slice(0, 60)}...`);
}

// Upload `script` to the VM and start it as root in the background.
// `stage` is updated as it goes so a failure can say where it stopped.
async function uploadAndStart(apiId, apiKey, vmId, script, job, stage) {
  const b64File = `/tmp/${job}.b64`, shFile = `/tmp/${job}.sh`, logFile = `/tmp/${job}.log`;
  const b64 = Buffer.from(script, 'utf8').toString('base64');

  // 1. Can we run commands, and as root?
  stage.now = 'checking the VM';
  const who = await runOnVm(apiId, apiKey, vmId, 'bash -c "id -u; sudo -n true 2>/dev/null && echo SUDO_OK"');
  const isRoot = /^0\s*$/m.test(who.stdout);
  const hasSudo = /SUDO_OK/.test(who.stdout);
  if (!isRoot && !hasSudo) {
    throw new Error('Commands on this VM do not run as root and passwordless sudo is not available, so the script has to be run by hand with sudo. (VM said: ' + (who.stdout.trim() || who.stderr.trim() || 'nothing') + ')');
  }
  const sudo = isRoot ? '' : 'sudo -n ';

  // 2. Upload in chunks (base64 only contains characters that are safe inside double quotes)
  stage.now = 'uploading the script';
  await runOnVm(apiId, apiKey, vmId, `bash -c "rm -f ${b64File} ${shFile}; : > ${b64File}"`);
  for (let i = 0; i < b64.length; i += CHUNK) {
    await runOnVm(apiId, apiKey, vmId, `bash -c "printf %s ${b64.slice(i, i + CHUNK)} >> ${b64File}"`);
  }

  // 3. Decode and verify the size matches what we sent
  stage.now = 'verifying the upload';
  const check = await runOnVm(apiId, apiKey, vmId, `bash -c "base64 -d ${b64File} > ${shFile} && wc -c < ${shFile}"`);
  const gotBytes = parseInt(check.stdout.trim(), 10);
  const wantBytes = Buffer.byteLength(script, 'utf8');
  if (gotBytes !== wantBytes) {
    throw new Error(`Script upload was corrupted (sent ${wantBytes} bytes, VM has ${isNaN(gotBytes) ? check.stdout.trim() || 'nothing' : gotBytes}).`);
  }

  // 4. Start it detached so it survives this command returning
  stage.now = 'starting the script';
  await runOnVm(apiId, apiKey, vmId,
    `bash -c "rm -f ${b64File}; ${sudo}setsid nohup bash ${shFile} > ${logFile} 2>&1 < /dev/null & echo STARTED"`);

  return { started: true, runsAs: isRoot ? 'root' : 'sudo', logPath: logFile, job };
}

// POST /api/cloudshare/vms/:vmId/run-setup — upload the App Scanner setup script and start it
router.post('/vms/:vmId/run-setup', async (req, res) => {
  const { apiId, apiKey, provisioningKey, ssmParamName, region } = req.body;
  const stage = { now: 'preparing' };
  try {
    if (!provisioningKey) throw new Error('No provisioning key — complete the ZPA Setup step first.');
    const script = generateSetupScript({ provisioningKey, ssmParamName, region });
    res.json(await uploadAndStart(apiId, apiKey, req.params.vmId, script, 'zpa-setup', stage));
  } catch (err) {
    console.error('[run-setup error]', stage.now, err.response?.status, csError(err));
    res.status(400).json({ error: `Failed while ${stage.now}: ${csError(err)}`, stage: stage.now });
  }
});

// POST /api/cloudshare/vms/:vmId/run-testapps — install Docker and start DVWA + Juice Shop
router.post('/vms/:vmId/run-testapps', async (req, res) => {
  const { apiId, apiKey } = req.body;
  const stage = { now: 'preparing' };
  try {
    res.json(await uploadAndStart(apiId, apiKey, req.params.vmId, generateTestAppsScript(), 'zpa-testapps', stage));
  } catch (err) {
    console.error('[run-testapps error]', stage.now, err.response?.status, csError(err));
    res.status(400).json({ error: `Failed while ${stage.now}: ${csError(err)}`, stage: stage.now });
  }
});

// GET /api/cloudshare/vms/:vmId/setup-log?job=zpa-setup|zpa-testapps — tail a script's log
router.get('/vms/:vmId/setup-log', async (req, res) => {
  const { apiId, apiKey } = req.query;
  const job = JOBS[req.query.job] ? req.query.job : 'zpa-setup';
  try {
    const out = await runOnVm(apiId, apiKey, req.params.vmId, `bash -c "tail -n 60 /tmp/${job}.log 2>&1"`, 30000);
    res.json({ log: out.stdout, done: out.stdout.includes(JOBS[job].done), failed: out.stdout.includes(FAIL_MARKER) });
  } catch (err) {
    // Expected for zpa-setup once the script reboots the VM at the end
    res.status(400).json({ error: csError(err) });
  }
});

module.exports = router;
