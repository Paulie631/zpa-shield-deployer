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
  if (!clientId || !clientSecret) throw new Error(`Zidentity client ID and secret are required${!clientSecret ? ' — the client secret is missing (paste it again)' : ''}`);
  const tokenUrl = `https://${vanityDomain}.zslogin.net/oauth2/v1/token`;
  let res;
  try {
    res = await axios.post(tokenUrl,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        audience: 'https://api.zscaler.com',
      }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }, timeout: 15000 }
    );
  } catch (err) {
    // Say what Zidentity said, and whether it's our input or their side
    const st = err.response?.status;
    const d = err.response?.data || {};
    const detail = d.error_description || d.error || d.message || (typeof d === 'string' ? d.slice(0, 200) : '');
    let hint = '';
    if (st === 401 || st === 400 || /invalid_client|unauthorized/i.test(detail)) hint = 'Zidentity rejected the client ID / secret. Check the API client in the Zidentity console (Integration → API Clients) and paste the secret again.';
    else if (st >= 500) hint = `Zidentity's sign-in service (${vanityDomain}.zslogin.net) returned a server error. This is on Zscaler's side — wait a minute and try again; if it persists, check status.zscaler.com.`;
    else if (!st) hint = `Couldn't reach ${vanityDomain}.zslogin.net — check the vanity domain and your network.`;
    const e = new Error(`Token request to ${vanityDomain}.zslogin.net failed${st ? ` (HTTP ${st})` : ''}${detail ? `: ${detail}` : ''}. ${hint}`.trim());
    e.response = err.response;
    throw e;
  }
  if (!res.data || !res.data.access_token) throw new Error(`Zidentity returned no access token (${JSON.stringify(res.data).slice(0, 200)})`);
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
  if (/^Token request to /.test(err.message || '')) return err.message;   // already explained
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

// GET /api/zpa/scim-groups — SCIM groups from each user IdP, for scoping the access rule
router.get('/scim-groups', async (req, res) => {
  try {
    const { headers, mgmtBase: base } = await getClient(req.query);
    const idps = (await axios.get(`${base}/idp`, { headers, params: { pagesize: 100 }, timeout: 15000 })).data.list || [];
    const groups = [];
    for (const idp of idps.filter(i => (i.ssoType || []).includes('USER') || !i.ssoType)) {
      for (let page = 1; page <= 10; page++) {
        const r = await axios.get(`${base.replace('/mgmtconfig/v1/', '/userconfig/v1/')}/scimgroup/idpId/${idp.id}`, { headers, params: { page, pagesize: 500 }, timeout: 15000 }).catch(() => ({ data: {} }));
        const list = r.data.list || [];
        groups.push(...list.map(g => ({ id: String(g.id), name: g.name, idpId: String(idp.id), idpName: idp.name })));
        if (page >= (parseInt(r.data.totalPages, 10) || 1)) break;
      }
    }
    groups.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ groups, idps: idps.map(i => ({ id: String(i.id), name: i.name })) });
  } catch (err) {
    res.status(400).json({ error: zpaError(err) });
  }
});

const ACCESS_RULE = 'ZPA Shield - allow test apps';

// v2 rule body: allow the test apps segment group, optionally only for one SCIM group
function accessRuleBody(segmentGroupId, scimGroup) {
  const conditions = [{ operands: [{ objectType: 'APP_GROUP', values: [segmentGroupId] }] }];
  if (scimGroup && scimGroup.idpId && scimGroup.groupId) {
    conditions.push({ operands: [{ objectType: 'SCIM_GROUP', entryValues: [{ lhs: String(scimGroup.idpId), rhs: String(scimGroup.groupId) }] }] });
  }
  return {
    name: ACCESS_RULE,
    description: (scimGroup?.name ? `Lets members of "${scimGroup.name}"` : 'Lets users') + ' reach DVWA and Juice Shop through ZPA - created by ZPA Shield Deployer',
    action: 'ALLOW',
    conditions,
  };
}

// POST /api/zpa/test-apps-access-rule — access policy rule allowing the test apps' segment group
// (v2 rule format, as in zscaler-sdk-python add_access_rule_v2). Re-running reuses the rule.
router.post('/test-apps-access-rule', async (req, res) => {
  const { scimGroup } = req.body;   // optional { idpId, groupId, name }
  let stage = 'connecting to ZPA';
  try {
    const { headers, mgmtBase: base } = await getClient(req.body);

    stage = 'finding the test apps segment group';
    const sg = await findByName(base, headers, 'segmentGroup', TEST_SEGMENT_GROUP);
    if (!sg) throw new Error(`Segment group "${TEST_SEGMENT_GROUP}" not found — create the test app segments first`);

    stage = 'reading the access policy';
    const policySet = (await axios.get(`${base}/policySet/policyType/ACCESS_POLICY`, { headers, timeout: 15000 })).data;
    const existing = await findByName(base, headers, 'policySet/rules/policyType/ACCESS_POLICY', ACCESS_RULE);
    const v2 = base.replace('/mgmtconfig/v1/', '/mgmtconfig/v2/');
    const scope = scimGroup?.name ? `members of "${scimGroup.name}"` : 'all users';
    if (existing) {
      // Re-apply so a changed scope (all users <-> a group) takes effect
      stage = 'updating the access rule';
      await axios.put(`${v2}/policySet/${policySet.id}/rule/${existing.id}`, accessRuleBody(sg.id, scimGroup), { headers, timeout: 15000 });
      return res.json({ ruleId: existing.id, steps: [`Access rule "${ACCESS_RULE}" updated — allows ${scope}`] });
    }

    stage = 'creating the access rule';
    const rule = (await axios.post(`${v2}/policySet/${policySet.id}/rule`, accessRuleBody(sg.id, scimGroup), { headers, timeout: 15000 })).data;
    res.json({ ruleId: rule.id, steps: [`Created access rule "${ACCESS_RULE}" for segment group "${TEST_SEGMENT_GROUP}" — allows ${scope}`] });
  } catch (err) {
    console.error('[access-rule error]', stage, err.response?.status, JSON.stringify(err.response?.data));
    res.status(400).json({ error: `Failed while ${stage}: ${zpaError(err)}` });
  }
});

// POST /api/zpa/verify-publish — check the published pieces: traffic connector(s) online,
// both app segments enabled and pointing at the test apps, access rule present.
router.post('/verify-publish', async (req, res) => {
  const { ip } = req.body;
  let stage = 'connecting to ZPA';
  try {
    const { headers, mgmtBase: base } = await getClient(req.body);
    const checks = [];

    stage = 'checking the traffic connector';
    const group = await findByName(base, headers, 'appConnectorGroup', TRAFFIC_GROUP);
    if (!group) {
      checks.push({ id: 'connector', ok: false, label: 'Traffic App Connector online', detail: `Connector group "${TRAFFIC_GROUP}" doesn't exist yet — run Publish Apps` });
    } else {
      const conns = [];
      for (let page = 1; page <= 10; page++) {
        const r = await axios.get(`${base}/connector`, { headers, params: { page, pagesize: 500 }, timeout: 15000 });
        conns.push(...(r.data.list || []));
        if (page >= (parseInt(r.data.totalPages, 10) || 1)) break;
      }
      const mine = conns.filter(c => c.appConnectorGroupId === group.id || c.appConnectorGroupName === TRAFFIC_GROUP);
      // ZPA reports e.g. ZPN_STATUS_AUTHENTICATED (online) / ZPN_STATUS_DISCONNECTED (offline)
      const isOnline = (s = '') => /AUTHENTICATED|ONLINE/i.test(s) || (/CONNECTED/i.test(s) && !/DISCONNECTED/i.test(s));
      const online = mine.filter(c => isOnline(c.controlChannelStatus));
      checks.push({
        id: 'connector', ok: online.length > 0, label: 'Traffic App Connector online',
        detail: mine.length === 0
          ? `No connector has enrolled in "${TRAFFIC_GROUP}" yet. A new connector takes about 5–10 minutes after its VM starts.`
          : mine.map(c => `${c.name}: ${c.controlChannelStatus || 'unknown'}${c.privateIp ? ' (' + c.privateIp + ')' : ''}`).join('; '),
      });
    }

    stage = 'checking the app segments';
    for (const app of TEST_APPS) {
      const seg = await findByName(base, headers, 'application', app.name);
      const pointsAtApp = seg && (!ip || (seg.domainNames || []).includes(ip));
      checks.push({
        id: 'seg-' + app.port, ok: !!(seg && seg.enabled !== false && pointsAtApp), label: `App segment "${app.name}"`,
        detail: !seg ? 'Not found — run Publish Apps' : seg.enabled === false ? 'Exists but is disabled'
          : !pointsAtApp ? `Points at ${(seg.domainNames || []).join(', ')}, not ${ip}` : `${(seg.domainNames || []).join(', ')} : ${app.port}`,
      });
    }

    stage = 'checking the access rule';
    const rule = await findByName(base, headers, 'policySet/rules/policyType/ACCESS_POLICY', ACCESS_RULE);
    // Who the rule applies to: no SCIM_GROUP operand = everyone in the tenant
    let scope = 'all users in the tenant';
    const scimOperands = [];
    for (const c of (rule?.conditions || [])) for (const o of (c.operands || [])) {
      if (o.objectType === 'SCIM_GROUP') scimOperands.push(...((o.entryValues || []).map(v => ({ idpId: String(v.lhs), groupId: String(v.rhs) })).concat(o.lhs && o.rhs ? [{ idpId: String(o.lhs), groupId: String(o.rhs) }] : [])));
    }
    if (scimOperands.length) {
      const names = [];
      for (const { idpId, groupId } of scimOperands) {
        try {
          const r = await axios.get(`${base.replace('/mgmtconfig/v1/', '/userconfig/v1/')}/scimgroup/idpId/${idpId}`, { headers, params: { pagesize: 500 }, timeout: 15000 });
          names.push((r.data.list || []).find(g => String(g.id) === groupId)?.name || `group ${groupId}`);
        } catch (e) { names.push(`group ${groupId}`); }
      }
      scope = `members of ${names.map(n => `"${n}"`).join(', ')} only`;
    }
    // ZPA sends disabled as "0"/"1" (string) on some tenants, boolean on others
    const ruleDisabled = !!rule && [true, 1, '1', 'true'].includes(rule.disabled);
    checks.push({
      id: 'rule', ok: !!rule && rule.action !== 'DENY' && !ruleDisabled,
      label: `Access rule "${ACCESS_RULE}"`,
      detail: !rule ? 'Not found — run Publish Apps' : ruleDisabled ? 'Present but disabled' : `Allows ${scope}`,
      scope: rule ? scope : null,
    });

    // IdP: Client Connector can only enrol a user for ZPA if an enabled IdP with user SSO
    // covers the user's email domain — otherwise ZCC shows "Unable to verify the IdP
    // configuration for this domain". IdPs live under mgmtconfig v2.
    stage = 'checking the identity provider';
    try {
      const idps = [];
      for (let page = 1; page <= 5; page++) {
        const r = await axios.get(`${base.replace('/mgmtconfig/v1/', '/mgmtconfig/v2/')}/idp`, { headers, params: { page, pagesize: 100 }, timeout: 15000 });
        idps.push(...(r.data.list || []));
        if (page >= (parseInt(r.data.totalPages, 10) || 1)) break;
      }
      const userSso = (i) => (i.ssoType || []).some(t => /USER/i.test(t)) || /USER/i.test(i.ssoType || '');
      const usable = idps.filter(i => i.enabled !== false && userSso(i));
      const domain = String(req.body.login || '').split('@')[1]?.toLowerCase();
      const covering = domain ? usable.filter(i => (i.domainList || []).map(d => String(d).toLowerCase()).includes(domain)) : usable;
      const describe = (i) => `${i.name} (${(i.domainList || []).join(', ') || 'no domains'})`;
      checks.push({
        id: 'idp', ok: covering.length > 0,
        label: domain ? `IdP with Client Connector SSO for @${domain}` : 'IdP with Client Connector SSO for users',
        detail: idps.length === 0 ? 'No IdP configured in ZPA. Add one (Zidentity) under Administration → Private Access Authentication / IdP Configuration, with Single Sign-On: User and the users\' email domain.'
          : usable.length === 0 ? `IdPs exist (${idps.map(describe).join('; ')}) but none is enabled with Single Sign-On for Users.`
          : covering.length === 0 ? `Enabled user IdPs: ${usable.map(describe).join('; ')} — none lists @${domain}. Add the domain to the IdP (for Zidentity: Zidentity → Organization → Domains), or ZCC will say "Unable to verify the IdP configuration for this domain".`
          : covering.map(describe).join('; '),
      });
    } catch (e) {
      checks.push({ id: 'idp', ok: true, label: 'IdP configuration', detail: `Couldn't read IdPs (${zpaError(e)}) — check Administration → Private Access Authentication by hand.` });
    }

    res.json({ checks, allOk: checks.every(c => c.ok) });
  } catch (err) {
    res.status(400).json({ error: `Failed while ${stage}: ${zpaError(err)}` });
  }
});

// POST /api/zpa/teardown — remove the objects this wizard created, in dependency order:
// access rule -> app segments -> server group -> segment group -> traffic connectors + keys + group
// (-> the App Scanner connector group, only if asked). Only wizard-named objects are touched.
router.post('/teardown', async (req, res) => {
  const { includeScannerGroup, scannerGroupId } = req.body;
  const results = [];
  const note = (item, ok, detail) => results.push({ item, ok, detail });
  try {
    const { headers, mgmtBase: base } = await getClient(req.body);
    const v2 = base.replace('/mgmtconfig/v1/', '/mgmtconfig/v2/');
    const del = async (item, path) => {
      try { await axios.delete(`${base}/${path}`, { headers, timeout: 15000 }); note(item, true, 'deleted'); }
      catch (e) { note(item, false, zpaError(e)); }
    };

    // Access rule
    const rule = await findByName(base, headers, 'policySet/rules/policyType/ACCESS_POLICY', ACCESS_RULE);
    if (rule) {
      const ps = (await axios.get(`${base}/policySet/policyType/ACCESS_POLICY`, { headers, timeout: 15000 })).data;
      await del(`Access rule "${ACCESS_RULE}"`, `policySet/${ps.id}/rule/${rule.id}`);
    } else note(`Access rule "${ACCESS_RULE}"`, true, 'already gone');

    // App segments
    for (const app of TEST_APPS) {
      const seg = await findByName(base, headers, 'application', app.name);
      if (seg) await del(`App segment "${app.name}"`, `application/${seg.id}?forceDelete=true`);
      else note(`App segment "${app.name}"`, true, 'already gone');
    }

    // Server group, segment group
    const srv = await findByName(base, headers, 'serverGroup', TEST_SERVER_GROUP);
    if (srv) await del(`Server group "${TEST_SERVER_GROUP}"`, `serverGroup/${srv.id}`); else note(`Server group "${TEST_SERVER_GROUP}"`, true, 'already gone');
    const sg = await findByName(base, headers, 'segmentGroup', TEST_SEGMENT_GROUP);
    if (sg) await del(`Segment group "${TEST_SEGMENT_GROUP}"`, `segmentGroup/${sg.id}`); else note(`Segment group "${TEST_SEGMENT_GROUP}"`, true, 'already gone');

    // Connector groups: their connectors and provisioning keys first
    const groups = [{ name: TRAFFIC_GROUP, id: (await findByName(base, headers, 'appConnectorGroup', TRAFFIC_GROUP))?.id }];
    if (includeScannerGroup && scannerGroupId) groups.push({ name: 'App Scanner group', id: scannerGroupId });
    for (const g of groups) {
      if (!g.id) { note(`Connector group "${g.name}"`, true, 'already gone'); continue; }
      let conns = [];
      try {
        for (let page = 1; page <= 10; page++) {
          const r = await axios.get(`${base}/connector`, { headers, params: { page, pagesize: 500 }, timeout: 15000 });
          conns.push(...(r.data.list || []).filter(c => c.appConnectorGroupId === g.id));
          if (page >= (parseInt(r.data.totalPages, 10) || 1)) break;
        }
      } catch (e) { note(`Connectors in "${g.name}"`, false, zpaError(e)); }
      for (const c of conns) await del(`Connector "${c.name}"`, `connector/${c.id}`);
      try {
        const keys = (await axios.get(`${base}/associationType/CONNECTOR_GRP/provisioningKey`, { headers, params: { pagesize: 500 }, timeout: 15000 })).data.list || [];
        for (const k of keys.filter(k => String(k.zcomponentId) === String(g.id) || String(k.appConnectorGroupId) === String(g.id))) {
          await del(`Provisioning key "${k.name}"`, `associationType/CONNECTOR_GRP/provisioningKey/${k.id}`);
        }
      } catch (e) { note(`Provisioning keys for "${g.name}"`, false, zpaError(e)); }
      await del(`Connector group "${g.name}"`, `appConnectorGroup/${g.id}`);
    }
    res.json({ results, allOk: results.every(r => r.ok) });
  } catch (err) {
    res.status(400).json({ error: zpaError(err), results });
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

// GET /api/zpa/version-profiles — connector version profiles visible to the tenant
router.get('/version-profiles', async (req, res) => {
  try {
    const { headers, mgmtBase: base } = await getClient(req.query);
    const r = await axios.get(`${base}/visible/versionProfiles`, { headers, params: { pagesize: 500 }, timeout: 15000 });
    const list = r.data.list || (Array.isArray(r.data) ? r.data : []);
    res.json(list.map(p => ({ id: String(p.id), name: p.name, description: p.description || '' })));
  } catch (err) { res.status(400).json({ error: zpaError(err) }); }
});

// PUT /api/zpa/connector-groups/:id/version-profile — pin the group to a version profile
// (the App Shield scanner needs the AppShield profile, which Portal Steps used to ask for by hand)
router.put('/connector-groups/:id/version-profile', async (req, res) => {
  const { versionProfileId } = req.body;
  try {
    if (!versionProfileId) throw new Error('versionProfileId is required');
    const { headers, mgmtBase: base } = await getClient(req.body);
    const group = (await axios.get(`${base}/appConnectorGroup/${req.params.id}`, { headers, timeout: 15000 })).data;
    const body = { ...group, overrideVersionProfile: true, versionProfileId: String(versionProfileId) };
    delete body.connectors; delete body.serverGroups;   // read-only sub-objects on PUT
    await axios.put(`${base}/appConnectorGroup/${req.params.id}`, body, { headers, timeout: 15000 });
    res.json({ ok: true, groupId: req.params.id, versionProfileId: String(versionProfileId) });
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

// ─── Zidentity (user entitlements) ──────────────────────────────────────────
// Zidentity's admin API rides the same OneAPI token: {gateway}/ziam/admin/api/v1.
// It can read a user's service entitlements and manage group membership, but has no
// call that writes an entitlement straight onto a user. Entitlements are granted to
// groups in the portal (Administration → Entitlements → Private Access), so the wizard
// puts the user in a group and the admin links that group once.
const ZID_GROUP = 'ZPA Shield Test Users';

async function zidClient(body) {
  const { authMode, clientId, clientSecret, cloudEnv, vanityDomain } = body;
  if (authMode !== 'oneapi') throw new Error('User entitlement checks need OneAPI (Zidentity) mode — legacy ZPA API keys cannot read Zidentity.');
  const token = await getOneApiToken(clientId, clientSecret, vanityDomain);
  return { base: `${oneApiGateway(cloudEnv)}/ziam/admin/api/v1`, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' } };
}

function zidError(err) {
  const st = err.response?.status;
  if (st === 401 || st === 403) {
    return `Zidentity refused the request (HTTP ${st}). The API client needs the Zidentity resource with user/group read-write scopes: Zidentity console → Integration → API Clients → your client → Resources → add "Zidentity" (users, groups). Then try again.`;
  }
  return zpaError(err);
}

const records = (d) => Array.isArray(d) ? d : (d?.records || d?.list || d?.results || []);

async function zidFindUser(c, login) {
  const want = String(login || '').trim().toLowerCase();
  if (!want) throw new Error('Enter the login the user signs in to Client Connector with (e.g. user@example.com)');
  const match = (u) => [u.loginName, u.primaryEmail].filter(Boolean).some(v => String(v).toLowerCase() === want);
  for (const p of [{ loginName: want }, { 'loginName[like]': want }, { 'primaryEmail[like]': want }]) {
    const r = await axios.get(`${c.base}/users`, { headers: c.headers, params: { ...p, limit: 100 }, timeout: 20000 });
    const hit = records(r.data).find(match);
    if (hit) return hit;
  }
  return null;
}

// What services is this user entitled to? Normalise whatever shape Zidentity returns.
async function zidServiceEntitlements(c, userId) {
  const r = await axios.get(`${c.base}/users/${encodeURIComponent(userId)}/service-entitlements`, { headers: c.headers, timeout: 20000 });
  const d = r.data;
  const items = Array.isArray(d) ? d : (d?.records || d?.services || d?.entitlements || (d?.service ? [d] : (d && typeof d === 'object' ? [d] : [])));
  const services = items.map(it => {
    const s = it.service || it;
    return { name: s.serviceName || s.name || s.displayName || '', cloud: s.cloudName || '', org: s.orgName || '' };
  }).filter(s => s.name);
  const hasZpa = services.some(s => /zpa|private.?access/i.test(s.name));
  return { services, hasZpa, raw: services.length ? undefined : d };
}

async function zidUserGroups(c, userId) {
  try {
    const r = await axios.get(`${c.base}/users/${encodeURIComponent(userId)}/groups`, { headers: c.headers, params: { limit: 500 }, timeout: 20000 });
    return records(r.data).map(g => g.name || g.displayName).filter(Boolean);
  } catch { return []; }
}

// POST /api/zpa/zid/check-user { ...auth, login } → user, entitlements, groups
router.post('/zid/check-user', async (req, res) => {
  try {
    const c = await zidClient(req.body);
    const user = await zidFindUser(c, req.body.login);
    if (!user) return res.json({ found: false, login: req.body.login, hint: `No Zidentity user matches "${req.body.login}". If ZPA signs users in through an external IdP (Okta, Entra…), that's expected — the user lives in that IdP, so this check doesn't apply; the IdP check above is what matters. Otherwise check the spelling or create the user (Administration → Authentication → Users).` });
    const [ent, groups] = await Promise.all([zidServiceEntitlements(c, user.id), zidUserGroups(c, user.id)]);
    res.json({
      found: true,
      user: { id: user.id, loginName: user.loginName, displayName: user.displayName, status: user.status, idp: user.idp?.name || user.idp?.displayName || (user.source === 'HOSTED' ? 'Zidentity (hosted DB)' : user.source) },
      services: ent.services, hasZpa: ent.hasZpa, raw: ent.raw, groups,
      inGroup: groups.some(g => g === ZID_GROUP), groupName: ZID_GROUP,
    });
  } catch (err) { res.status(400).json({ error: zidError(err) }); }
});

// POST /api/zpa/zid/entitle-user { ...auth, login } → put the user in ZID_GROUP (create it if
// needed) and re-read entitlements. If Private Access still isn't on, the group hasn't been
// linked to the entitlement yet — that's the one portal step.
router.post('/zid/entitle-user', async (req, res) => {
  try {
    const c = await zidClient(req.body);
    const user = await zidFindUser(c, req.body.login);
    if (!user) return res.status(404).json({ error: `No Zidentity user matches "${req.body.login}"` });

    let group = null, createdGroup = false;
    const g = await axios.get(`${c.base}/groups`, { headers: c.headers, params: { 'name[like]': ZID_GROUP, limit: 100 }, timeout: 20000 });
    group = records(g.data).find(x => x.name === ZID_GROUP) || null;
    if (!group) {
      const made = await axios.post(`${c.base}/groups`, {
        name: ZID_GROUP, description: 'Users allowed to reach the ZPA Shield test apps — created by ZPA Shield Deployer',
        source: 'MANUAL', isDynamicGroup: false, serviceEntitlementEnabled: true, adminEntitlementEnabled: false,
      }, { headers: c.headers, timeout: 20000 });
      group = made.data; createdGroup = true;
    }

    const before = await zidServiceEntitlements(c, user.id);
    const groups = await zidUserGroups(c, user.id);
    let addedToGroup = false;
    if (!groups.includes(ZID_GROUP)) {
      await axios.post(`${c.base}/groups/${encodeURIComponent(group.id)}/users/${encodeURIComponent(user.id)}`, {}, { headers: c.headers, timeout: 20000 });
      addedToGroup = true;
    }
    // Entitlement propagation can lag a moment
    let after = await zidServiceEntitlements(c, user.id);
    if (!after.hasZpa && addedToGroup) { await new Promise(r => setTimeout(r, 2500)); after = await zidServiceEntitlements(c, user.id); }

    res.json({
      user: { id: user.id, loginName: user.loginName }, group: { id: group.id, name: group.name }, createdGroup, addedToGroup,
      hadZpa: before.hasZpa, hasZpa: after.hasZpa, services: after.services,
      portalStep: after.hasZpa ? null : `"${ZID_GROUP}" is not linked to the Private Access entitlement yet. One-time portal step: Experience Center → Administration → Entitlements → Private Access → add the group "${ZID_GROUP}" (Zidentity console: Administration → Entitlements → Service Entitlements → Private Access). Then click "Check again".`,
    });
  } catch (err) { res.status(400).json({ error: zidError(err) }); }
});

module.exports = router;
