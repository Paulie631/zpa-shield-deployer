const express = require('express');
const router = express.Router();
const axios = require('axios');
const crypto = require('crypto');
const { generateSetupScript } = require('../templates/setupScript');
const { generateTestAppsScript } = require('../templates/testAppsScript');
const { generateConnectorScript } = require('../templates/connectorScript');

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

async function csDelete(apiId, apiKey, path) {
  const res = await axios.delete(CS_BASE + path, { headers: csHeaders(apiId, apiKey, path), timeout: 15000 });
  return res.data;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// DELETE /api/cloudshare/envs/:envId — delete an environment (used by tear-down for the test client)
router.delete('/envs/:envId', async (req, res) => {
  const { apiId, apiKey } = req.query;
  try {
    await csDelete(apiId, apiKey, `/api/v3/envs/${encodeURIComponent(req.params.envId)}`);
    res.json({ deleted: true });
  } catch (err) {
    res.status(400).json({ error: csError(err) });
  }
});

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

// GET /api/cloudshare/blueprint-machines — machines in a blueprint's default snapshot,
// so a known-good machine can be added to an existing environment
router.get('/blueprint-machines', async (req, res) => {
  const { apiId, apiKey, projectId, blueprintId } = req.query;
  try {
    const bp = await csGet(apiId, apiKey, `/api/v3/projects/${encodeURIComponent(projectId)}/blueprints/${encodeURIComponent(blueprintId)}`);
    const versions = bp.createFromVersions || [];
    const snap = versions.find(v => v.isDefault) || versions.find(v => v.isLatest) || versions[0];
    if (!snap) throw new Error('This blueprint has no snapshots');
    let machines = snap.machines;
    if (!machines || !machines.length) machines = (await csGet(apiId, apiKey, `/api/v3/snapshots/${encodeURIComponent(snap.id)}`)).machines || [];
    res.json(machines.map(m => ({
      machineId: m.id, name: m.name, os: m.osTypeName, snapshotName: snap.name,
      resources: m.resources ? { cpuCount: m.resources.cpuCount, memorySizeMB: m.resources.memorySizeMB } : null,
    })));
  } catch (err) {
    res.status(400).json({ error: csError(err) });
  }
});

// POST /api/cloudshare/envs/:envId/vms — add a VM to an existing environment,
// from a VM template (templateVmId) or from a blueprint snapshot machine (machineId)
router.post('/envs/:envId/vms', async (req, res) => {
  const { apiId, apiKey, templateVmId, machineId, name, description } = req.body;
  const { envId } = req.params;
  try {
    if (!templateVmId && !machineId) throw new Error('templateVmId or machineId is required');
    const item = machineId
      ? { type: 4, machineId, disconnectedFromNetworks: false }
      : { type: 2, templateVmId };
    const result = await csPut(apiId, apiKey, '/api/v3/envs', {
      envId,
      itemsCart: [{ ...item, name: name || 'ZPA Test Apps', description: description || 'Added by ZPA Shield Deployer' }],
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
  'zpa-traffic':  { done: 'Connector setup complete!' },
};
const FAIL_MARKER = 'SCRIPT FAILED';
const CHUNK = 1500;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Translate CloudShare's terse API errors into something a user can act on
const csError = (err) => {
  const raw = err.response?.data?.message || err.response?.data?.Message || err.message || String(err);
  const st = err.response?.status;
  if (/HMAC/i.test(raw) || st === 401) return `CloudShare rejected the API credentials (${raw}). The API key is wrong or was retyped — leave the key blank to use the one saved on this Mac, or copy a fresh one from CloudShare → My Profile → API Keys.`;
  if (st === 403) return `CloudShare says this API ID isn't allowed to do that (${raw}). Check the user behind the API key has access to the project/environment.`;
  if (/already exists|name.*taken/i.test(raw)) return `${raw} — pick a different environment name.`;
  if (/ECONNABORTED|timeout/i.test(raw)) return 'CloudShare did not answer in time. Try again; if it keeps happening, check use.cloudshare.com is reachable from this Mac.';
  return raw;
};

// Run one command on the VM and wait for it to finish. Returns its stdout.
async function runOnVm(apiId, apiKey, vmId, command, timeoutMs = 45000) {
  const started = await csPost(apiId, apiKey, '/api/v3/vms/actions/executepath', { vmId, path: command });
  const executionId = started && started.executionId;
  if (!executionId) throw new Error('CloudShare did not return an executionId: ' + JSON.stringify(started));
  const q = `/api/v3/vms/actions/checkexecutionstatus?vmId=${encodeURIComponent(vmId)}&executionId=${encodeURIComponent(executionId)}`;
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(2000);
    const st = await csGet(apiId, apiKey, q);
    last = st;
    if (st && st.success) {
      return { stdout: st.standardOutput || '', stderr: st.standardError || '', raw: st };
    }
    // CloudShare only sets success=true for a clean finish; a non-zero exit code means it finished and failed
    if (st && typeof st.exitCode === 'number' && st.exitCode !== 0) {
      const detail = (st.standardError || st.standardOutput || '').trim().slice(0, 300);
      throw new Error(`Command failed on the VM (exit code ${st.exitCode})${detail ? ': ' + detail : ''}`);
    }
  }
  const seen = last ? Object.entries(last).filter(([k, v]) => v !== null && v !== '' && k !== 'executedPath')
    .map(([k, v]) => `${k}=${String(v).slice(0, 80)}`).join(', ') : 'no status returned';
  throw new Error(`CloudShare never reported the command as finished after ${Math.round(timeoutMs / 1000)}s (last status: ${seen || 'empty'}). CloudShare may not be able to run commands on this VM — its guest tools may be missing or its OS login may differ from what CloudShare has on file.`);
}

// Upload `script` to the VM and start it as root in the background.
// `stage` is updated as it goes so a failure can say where it stopped.
async function uploadAndStart(apiId, apiKey, vmId, script, job, stage) {
  // Logs go under /var/log so they survive the scanner's reboot and /tmp cleanup
  const b64File = `/tmp/${job}.b64`, shFile = `/tmp/${job}.sh`, logFile = `/var/log/zpa-shield-${job}.log`;
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
    `bash -c "rm -f ${b64File}; ${sudo}touch ${logFile}; ${sudo}chmod 644 ${logFile}; ${sudo}setsid nohup bash ${shFile} > ${logFile} 2>&1 < /dev/null & echo STARTED"`);

  return { started: true, runsAs: isRoot ? 'root' : 'sudo', logPath: logFile, job };
}

// Run a short script on the VM in one command (base64 keeps the quoting safe)
async function runInline(apiId, apiKey, vmId, script, timeoutMs = 60000) {
  const b64 = Buffer.from(script, 'utf8').toString('base64');
  return runOnVm(apiId, apiKey, vmId, `bash -c "echo ${b64} | base64 -d | bash"`, timeoutMs);
}

const NET_CHECK_SCRIPT = [
  'echo "IPS: $(ip -4 -o addr show scope global 2>/dev/null | awk \'{print $4}\' | tr \'\\n\' \' \')"',
  'R=$(ip route 2>/dev/null | grep "^default" | head -1); echo "ROUTE: ${R:-NONE}"',
  'echo "NAMESERVERS: $(grep -E "^nameserver" /etc/resolv.conf 2>/dev/null | awk \'{print $2}\' | tr \'\\n\' \' \')"',
  'getent hosts registry-1.docker.io >/dev/null 2>&1 && echo "DNS: OK" || echo "DNS: FAIL"',
  'ping -c1 -W3 8.8.8.8 >/dev/null 2>&1 && echo "PING: OK" || echo "PING: FAIL"',
  'if command -v curl >/dev/null 2>&1; then C=$(curl -s -o /dev/null -m 10 -w "%{http_code}" https://registry-1.docker.io/v2/ 2>/dev/null); echo "HTTPS: ${C:-000}"; else echo "HTTPS: NOCURL"; fi',
].join('\n');

// POST /api/cloudshare/vms/:vmId/check-network — can this VM reach the internet?
router.post('/vms/:vmId/check-network', async (req, res) => {
  const { apiId, apiKey } = req.body;
  try {
    const out = await runInline(apiId, apiKey, req.params.vmId, NET_CHECK_SCRIPT, 60000);
    const get = (k) => ((out.stdout.match(new RegExp('^' + k + ':\\s*(.*)$', 'm')) || [])[1] || '').trim();
    const ips = get('IPS'), route = get('ROUTE'), dns = get('DNS'), ping = get('PING'), https = get('HTTPS');
    const httpsOk = /^[1-5]\d\d$/.test(https);           // any HTTP reply means we got out
    const ok = httpsOk || (https === 'NOCURL' && dns === 'OK');
    let reason = '';
    if (!ok) {
      if (!ips) reason = 'The VM has no IPv4 address — it is not connected to a network.';
      else if (route === 'NONE') reason = 'The VM has no default route, so it has no way out to the internet. It is probably on a network without internet access.';
      else if (ping === 'FAIL' && dns === 'FAIL') reason = 'The VM has an address and a route but cannot reach the internet (no ping to 8.8.8.8, no DNS). Outbound traffic is blocked for this VM.';
      else if (dns === 'FAIL') reason = 'The VM reaches the internet by IP but DNS lookups fail. The test apps script can work around this by using public DNS.';
      else reason = 'The VM cannot make HTTPS connections to the internet (HTTPS check returned ' + (https || 'nothing') + ').';
    }
    const dnsOnly = !ok && ping === 'OK' && dns === 'FAIL';
    res.json({ ok, dnsOnly, reason, ips, route, nameservers: get('NAMESERVERS'), dns, ping, https, raw: out.stdout });
  } catch (err) {
    res.status(400).json({ error: csError(err) });
  }
});

async function editHardware(apiId, apiKey, body) {
  try {
    return await csPut(apiId, apiKey, '/api/v3/vms/actions/editvmhardware', body);
  } catch (e) {
    // CloudShare's docs show both spellings of this path
    if (e.response?.status !== 404) throw e;
    return csPut(apiId, apiKey, '/api/v3/vms/action/editvmhardware', body);
  }
}

// POST /api/cloudshare/vms/:vmId/check-apps — from a client VM (with Zscaler Client Connector),
// request each URL and report the HTTP status. Any HTTP reply means the app was reached.
router.post('/vms/:vmId/check-apps', async (req, res) => {
  const { apiId, apiKey, urls = [] } = req.body;
  const clean = urls.filter(u => /^https?:\/\/[0-9a-zA-Z.\-:]+\/?$/.test(u));
  if (!clean.length) return res.status(400).json({ error: 'No valid URLs to check' });
  const parse = (out) => {
    const results = clean.map(u => {
      const m = out.match(new RegExp('^URL ' + u.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + ' -> (.*)$', 'm'));
      const v = m ? m[1].trim() : 'no result';
      return { url: u, result: v, ok: /^[1-5]\d\d$/.test(v) };
    });
    const zcc = (out.match(/^ZCC: (.*)$/m) || [])[1] || '';
    return { results, zcc: zcc.trim(), raw: out };
  };
  try {
    // Windows: PowerShell via -EncodedCommand (UTF-16LE base64) so nothing needs quoting
    const ps = [
      "$ErrorActionPreference = 'SilentlyContinue'",
      "$svc = Get-Service | Where-Object { $_.DisplayName -like '*Zscaler*' } | ForEach-Object { $_.DisplayName + '=' + $_.Status }",
      "'ZCC: ' + ($svc -join '; ')",
      `foreach ($u in @(${clean.map(u => `'${u}'`).join(',')})) {`,
      "  try { $r = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 20 -MaximumRedirection 0; 'URL ' + $u + ' -> ' + $r.StatusCode }",
      "  catch { $c = $_.Exception.Response.StatusCode.value__; if ($c) { 'URL ' + $u + ' -> ' + $c } else { 'URL ' + $u + ' -> ERROR ' + $_.Exception.Message } }",
      "}",
    ].join('\n');
    const enc = Buffer.from(ps, 'utf16le').toString('base64');
    try {
      const out = await runOnVm(apiId, apiKey, req.params.vmId, `powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${enc}`, 120000);
      if (/^URL /m.test(out.stdout)) return res.json({ os: 'windows', ...parse(out.stdout) });
    } catch (e) { /* not Windows (or PowerShell unavailable) — try Linux */ }
    const sh = [
      'echo "ZCC: $(systemctl is-active zsaservice 2>/dev/null || pgrep -fl -i zscaler | head -1 || echo not found)"',
      ...clean.map(u => `echo "URL ${u} -> $(curl -s -o /dev/null -m 20 -w '%{http_code}' '${u}' || echo ERROR)"`),
    ].join('\n');
    const out = await runInline(apiId, apiKey, req.params.vmId, sh, 120000);
    res.json({ os: 'linux', ...parse(out.stdout) });
  } catch (err) {
    res.status(400).json({ error: csError(err) });
  }
});

// PUT /api/cloudshare/vms/:vmId/hardware — resize CPU / RAM / disk.
// CloudShare product tiers cap VM sizes, so step down whichever resource the
// error names until CloudShare accepts it, and report what was applied.
const STEPS = {
  numCpus: [16, 12, 8, 6, 4, 2],
  memorySizeMBs: [16384, 12288, 8192, 6144, 4096],
  diskSizeGBs: [200, 160, 120, 100, 80, 60],
};
router.put('/vms/:vmId/hardware', async (req, res) => {
  const { apiId, apiKey, numCpus, memorySizeMBs, diskSizeGBs } = req.body;
  const want = { numCpus, memorySizeMBs, diskSizeGBs };
  const cur = { ...want };
  const limits = [];
  try {
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const result = await editHardware(apiId, apiKey, { vmId: req.params.vmId, ...cur });
        return res.json({ ...(result || {}), applied: cur, requested: want, reduced: limits.length > 0, limits });
      } catch (e) {
        const msg = csError(e);
        const key = /cpu/i.test(msg) ? 'numCpus' : /memory|ram/i.test(msg) ? 'memorySizeMBs' : /disk/i.test(msg) ? 'diskSizeGBs' : null;
        const lower = key && STEPS[key].find(v => v < cur[key]);
        if (!key || !lower) throw e;          // not a size limit, or nothing smaller to try
        limits.push(msg);
        cur[key] = lower;
      }
    }
    throw new Error('CloudShare kept rejecting the resize');
  } catch (err) {
    res.status(400).json({ error: csError(err), limits });
  }
});

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
// POST /api/cloudshare/vms/:vmId/run-traffic-connector — enroll a standard App Connector on a VM
// (the test apps VM: the prebuilt connector image already has zpa-connector, it just needs a key)
router.post('/vms/:vmId/run-traffic-connector', async (req, res) => {
  const { apiId, apiKey, provisioningKey } = req.body;
  const stage = { now: 'preparing' };
  try {
    if (!provisioningKey) throw new Error('No provisioning key for the traffic connector');
    res.json(await uploadAndStart(apiId, apiKey, req.params.vmId, generateConnectorScript({ provisioningKey }), 'zpa-traffic', stage));
  } catch (err) {
    console.error('[run-traffic-connector error]', stage.now, err.response?.status, csError(err));
    res.status(400).json({ error: `Failed while ${stage.now}: ${csError(err)}`, stage: stage.now });
  }
});

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
    const out = await runOnVm(apiId, apiKey, req.params.vmId, `bash -c "tail -n 60 /var/log/zpa-shield-${job}.log 2>/dev/null || tail -n 60 /tmp/${job}.log 2>&1"`, 30000);
    res.json({ log: out.stdout, done: out.stdout.includes(JOBS[job].done), failed: out.stdout.includes(FAIL_MARKER) });
  } catch (err) {
    // Expected for zpa-setup once the script reboots the VM at the end
    res.status(400).json({ error: csError(err) });
  }
});

module.exports = router;
