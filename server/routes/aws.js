const express = require('express');
const router = express.Router();
const { CloudFormationClient, CreateStackCommand, DescribeStacksCommand, DescribeStackEventsCommand, DeleteStackCommand, DescribeStackResourceCommand } = require('@aws-sdk/client-cloudformation');
const { EC2Client, DescribeVpcsCommand, DescribeSubnetsCommand, DescribeKeyPairsCommand, DescribeImagesCommand, AuthorizeSecurityGroupIngressCommand, AuthorizeSecurityGroupEgressCommand } = require('@aws-sdk/client-ec2');
const { DeleteParameterCommand } = require('@aws-sdk/client-ssm');
const { SSMClient, PutParameterCommand } = require('@aws-sdk/client-ssm');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');
const { isManaged, runShell } = require('../lib/ssm');
const timings = require('../lib/timings');
const { notify } = require('../lib/notify');

// Session Manager access for an instance: role + profile, no SSH or inbound ports needed
function ssmRoleResources(prefix) {
  return {
    [`${prefix}Role`]: { Type: 'AWS::IAM::Role', Properties: {
      AssumeRolePolicyDocument: { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' }] },
      ManagedPolicyArns: ['arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore'],
    } },
    [`${prefix}InstanceProfile`]: { Type: 'AWS::IAM::InstanceProfile', Properties: { Roles: [{ Ref: `${prefix}Role` }] } },
  };
}
// Prepend to user data: install the SSM agent on RHEL 9 (not in the image)
const SSM_AGENT_PRELUDE = [
  '# Session Manager agent so EC2 -> Connect works without SSH',
  '(dnf install -y https://s3.amazonaws.com/ec2-downloads-windows/SSMAgent/latest/linux_amd64/amazon-ssm-agent.rpm >/dev/null 2>&1 && systemctl enable --now amazon-ssm-agent) || echo "(SSM agent install skipped)"',
].join('\n');
const withSsmAgent = (script) => script.replace(/^(#!\/bin\/bash\n(?:set [^\n]*\n)?(?:trap [^\n]*\n)?)/, `$1${SSM_AGENT_PRELUDE}\n`);
const { STSClient, GetCallerIdentityCommand } = require('@aws-sdk/client-sts');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { generateCfnTemplate } = require('../templates/cfnTemplate');
const { generateSetupScript } = require('../templates/setupScript');
const { generateTestAppsScript } = require('../templates/testAppsScript');
const { generateConnectorScript } = require('../templates/connectorScript');

// Latest official RHEL 9 x86_64 AMI in this region (Red Hat's AWS account), so stacks
// work outside us-east-1. Falls back to the known us-east-1 image if the lookup fails.
const RED_HAT_OWNER = '309956199498';
const FALLBACK_AMI = 'ami-0fe630eb857a6ec83';
async function rhel9Ami(ec2, region) {
  try {
    const r = await ec2.send(new DescribeImagesCommand({
      Owners: [RED_HAT_OWNER],
      Filters: [
        { Name: 'name', Values: ['RHEL-9.*_HVM-*-x86_64-*'] },
        { Name: 'architecture', Values: ['x86_64'] },
        { Name: 'state', Values: ['available'] },
      ],
    }));
    const imgs = (r.Images || []).filter(i => !/BETA|beta/.test(i.Name || ''))
      .sort((a, b) => String(b.CreationDate).localeCompare(String(a.CreationDate)));
    if (imgs[0]) return imgs[0].ImageId;
  } catch (e) { console.warn('[rhel9Ami] lookup failed:', e.message); }
  if (region !== 'us-east-1') throw new Error(`Could not find a RHEL 9 AMI in ${region}. Check the AWS keys can call ec2:DescribeImages.`);
  return FALLBACK_AMI;
}

// sessionToken is needed for temporary keys (access key IDs starting with ASIA),
// e.g. from the AWS access portal / IAM Identity Center
// Create a stack; if one with this name already exists (e.g. deployed before a page
// refresh), use it rather than failing — the wizard then just tracks its status.
// A stack that failed to create can't be updated or reused — it must be deleted first.
const DEAD_STATES = ['ROLLBACK_COMPLETE', 'ROLLBACK_FAILED', 'CREATE_FAILED', 'DELETE_FAILED'];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function createStackOrReuse(cfn, params) {
  try {
    await cfn.send(new CreateStackCommand(params));
    return false;
  } catch (e) {
    if (!(e.name === 'AlreadyExistsException' || /already exists/i.test(e.message || ''))) throw e;
    const cur = (await cfn.send(new DescribeStacksCommand({ StackName: params.StackName }))).Stacks[0];
    if (!DEAD_STATES.includes(cur.StackStatus)) return true;           // healthy or in progress: track it
    console.log(`[aws] ${params.StackName} is ${cur.StackStatus} — deleting it before relaunching`);
    await cfn.send(new DeleteStackCommand({ StackName: params.StackName }));
    for (let i = 0; i < 60; i++) {                                     // up to ~5 minutes
      await sleep(5000);
      try {
        const s = (await cfn.send(new DescribeStacksCommand({ StackName: params.StackName }))).Stacks[0];
        if (s.StackStatus === 'DELETE_FAILED') throw new Error(`Couldn't delete the failed stack ${params.StackName}: ${s.StackStatusReason || 'see the AWS console'}`);
      } catch (err) {
        if (/does not exist/i.test(err.message || '')) { await cfn.send(new CreateStackCommand(params)); return false; }
        throw err;
      }
    }
    throw new Error(`Timed out waiting for the failed stack ${params.StackName} to be deleted`);
  }
}

// The first real failure reasons from a stack's events (skipping the knock-on "cancelled" ones)
async function stackFailures(cfn, stackName) {
  const r = await cfn.send(new DescribeStackEventsCommand({ StackName: stackName }));
  return (r.StackEvents || [])
    .filter(e => /FAILED$/.test(e.ResourceStatus || '') && e.ResourceStatusReason
      && !/cancelled|canceled/i.test(e.ResourceStatusReason) && e.ResourceType !== 'AWS::CloudFormation::Stack')
    .reverse()
    .slice(0, 5)
    .map(e => ({ resource: e.LogicalResourceId, type: e.ResourceType, reason: e.ResourceStatusReason }));
}

async function vpcCidr(ec2, vpcId) {
  const r = await ec2.send(new DescribeVpcsCommand({ VpcIds: [vpcId] }));
  const cidr = r.Vpcs?.[0]?.CidrBlock;
  if (!cidr) throw new Error(`Couldn't read the address range of ${vpcId}`);
  return cidr;
}

// Network paths the scan needs inside the VPC:
//   test apps  <- the test-app ports from the VPC (scanner + App Connectors reach apps directly)
//   scanner    -> anything in the VPC (it probes the apps' ports)
const { TEST_APPS, TEST_APP_PORTS, TEST_APPS_INSTANCE_TYPE } = require('../lib/testApps');
function testAppsIngress(cidr) {
  return TEST_APP_PORTS.map(p => ({ IpProtocol: 'tcp', FromPort: p, ToPort: p, CidrIp: cidr, Description: `Test app port ${p} from the VPC` }));
}
function scannerEgressToVpc(cidr) {
  return { IpProtocol: '-1', CidrIp: cidr, Description: 'Scan apps inside the VPC' };
}

// Profiles in ~/.aws/config and ~/.aws/credentials (the backend runs on the user's own machine)
function listAwsProfiles() {
  const names = new Set();
  const read = (file, strip) => {
    try {
      for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*\[\s*(.+?)\s*\]\s*$/);
        if (!m) continue;
        const n = strip ? m[1].replace(/^profile\s+/, '') : m[1];
        if (!/^sso-session\s/.test(n) && !/^services\s/.test(n)) names.add(n);
      }
    } catch (e) { /* file missing is fine */ }
  };
  read(path.join(os.homedir(), '.aws', 'config'), true);
  read(path.join(os.homedir(), '.aws', 'credentials'), false);
  return [...names];
}

// Credentials for the SDK clients: a local CLI profile (SSO, assumed role, keys — whatever it
// is configured with, refreshed by the SDK) or keys pasted into the wizard.
function credentialsFor({ profile, accessKeyId, secretAccessKey, sessionToken }) {
  if (profile) return fromNodeProviderChain({ profile });
  const credentials = { accessKeyId: (accessKeyId || '').trim(), secretAccessKey: (secretAccessKey || '').trim() };
  if (sessionToken && sessionToken.trim()) credentials.sessionToken = sessionToken.trim();
  return credentials;
}

// Turn SDK credential errors into something the person can act on
function credentialError(err, profile) {
  const msg = err.message || String(err);
  if (profile && /sso|token|expired|refresh|login/i.test(msg)) {
    return `The AWS CLI session for profile "${profile}" has expired or isn't signed in. Run: aws sso login --profile ${profile}`;
  }
  if (profile && /Could not load credentials|Could not resolve|could not be found|not found/i.test(msg)) {
    return `AWS profile "${profile}" has no usable credentials — pick another profile, or set this one up with "aws configure sso" (${msg})`;
  }
  return msg;
}

function awsClients(accessKeyId, secretAccessKey, region, sessionToken, profile) {
  const creds = { credentials: credentialsFor({ profile, accessKeyId, secretAccessKey, sessionToken }), region };
  return {
    cfn: new CloudFormationClient(creds),
    ec2: new EC2Client(creds),
    ssm: new SSMClient(creds)
  };
}

// GET /api/aws/resources
router.get('/resources', async (req, res) => {
  const { accessKeyId, secretAccessKey, sessionToken, awsProfile, region } = req.query;
  try {
    const { ec2 } = awsClients(accessKeyId, secretAccessKey, region, sessionToken, awsProfile);
    const [vpcs, subnets, keyPairs] = await Promise.all([
      ec2.send(new DescribeVpcsCommand({})),
      ec2.send(new DescribeSubnetsCommand({})),
      ec2.send(new DescribeKeyPairsCommand({}))
    ]);
    res.json({
      vpcs: vpcs.Vpcs.map(v => ({ id: v.VpcId, cidr: v.CidrBlock, name: v.Tags?.find(t => t.Key === 'Name')?.Value || '' })),
      subnets: subnets.Subnets.map(s => ({ id: s.SubnetId, cidr: s.CidrBlock, az: s.AvailabilityZone, vpcId: s.VpcId, name: s.Tags?.find(t => t.Key === 'Name')?.Value || '' })),
      keyPairs: keyPairs.KeyPairs.map(k => ({ name: k.KeyName }))
    });
  } catch (err) {
    res.status(400).json({ error: credentialError(err, awsProfile) });
  }
});

// GET /api/aws/profiles — AWS CLI profiles on this machine
router.get('/profiles', (req, res) => {
  res.json({ profiles: listAwsProfiles(), home: os.homedir() });
});

// GET /api/aws/whoami — can these credentials be used, and who are they? (also warms SSO)
router.get('/whoami', async (req, res) => {
  const { accessKeyId, secretAccessKey, sessionToken, awsProfile, region } = req.query;
  try {
    const sts = new STSClient({ credentials: credentialsFor({ profile: awsProfile, accessKeyId, secretAccessKey, sessionToken }), region: region || 'us-east-1' });
    const id = await sts.send(new GetCallerIdentityCommand({}));
    let expiration = null;
    if (awsProfile) { try { expiration = (await fromNodeProviderChain({ profile: awsProfile })()).expiration || null; } catch (e) { /* ignore */ } }
    res.json({ account: id.Account, arn: id.Arn, expiration });
  } catch (err) {
    res.status(400).json({ error: credentialError(err, awsProfile) });
  }
});

// POST /api/aws/deploy — App Scanner
router.post('/deploy', async (req, res) => {
  const { accessKeyId, secretAccessKey, sessionToken, awsProfile, region, vpcId, subnetId, keyPairName,
    instanceType, ebsSize, ssmParamName, provisioningKey, stackName } = req.body;
  try {
    const { cfn, ssm, ec2 } = awsClients(accessKeyId, secretAccessKey, region, sessionToken, awsProfile);
    const imageId = await rhel9Ami(ec2, region);

    // Store provisioning key in SSM
    await ssm.send(new PutParameterCommand({
      Name: ssmParamName || '/zpa/provisioning-key',
      Value: provisioningKey,
      Type: 'SecureString',
      Overwrite: true
    }));

    const script = generateSetupScript({ ssmParamName: ssmParamName || '/zpa/provisioning-key', provisioningKey, region });
    const cidr = await vpcCidr(ec2, vpcId);
    const template = generateCfnTemplate({ vpcId, subnetId, keyPairName, instanceType, ebsSize, script, imageId, vpcCidr: cidr, ssmParamName: ssmParamName || '/zpa/provisioning-key' });

    const finalStackName = stackName || 'zpa-app-scanner';
    await createStackOrReuse(cfn, {
      StackName: finalStackName,
      TemplateBody: template,
      Capabilities: ['CAPABILITY_IAM']
    });

    res.json({
      stackName: finalStackName,
      consoleUrl: `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks`
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/aws/stack-status
router.get('/stack-status', async (req, res) => {
  const { stackName, region, accessKeyId, secretAccessKey, sessionToken, awsProfile } = req.query;
  try {
    const { cfn } = awsClients(accessKeyId, secretAccessKey, region, sessionToken, awsProfile);
    const r = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
    const stack = r.Stacks[0];
    const failed = /FAILED|ROLLBACK/.test(stack.StackStatus);
    res.json({
      status: stack.StackStatus,
      outputs: stack.Outputs || [],
      reason: stack.StackStatusReason || '',
      failures: failed ? await stackFailures(cfn, stackName).catch(() => []) : [],
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/aws/deploy-test-apps — DVWA + Juice Shop
router.post('/deploy-test-apps', async (req, res) => {
  const { accessKeyId, secretAccessKey, sessionToken, awsProfile, region, vpcId, subnetId, keyPairName, instanceType, stackName } = req.body;
  try {
    const { cfn, ec2 } = awsClients(accessKeyId, secretAccessKey, region, sessionToken, awsProfile);
    const imageId = await rhel9Ami(ec2, region);

    // Same script as CloudShare: Docker CE (RHEL 9's own "docker" package is podman,
    // which has no docker service) + DVWA + Juice Shop
    const userDataScript = Buffer.from(withSsmAgent(generateTestAppsScript())).toString('base64');
    const cidr = await vpcCidr(ec2, vpcId);

    const template = JSON.stringify({
      AWSTemplateFormatVersion: '2010-09-09',
      Description: 'ZPA Shield Test Apps - DVWA + OWASP Juice Shop',
      Resources: {
        TestAppsSecurityGroup: {
          Type: 'AWS::EC2::SecurityGroup',
          Properties: {
            GroupDescription: `ZPA Test Apps - ports ${TEST_APP_PORTS.join('/')} from inside the VPC only`,
            VpcId: vpcId,
            SecurityGroupIngress: testAppsIngress(cidr),
            SecurityGroupEgress: [{ IpProtocol: '-1', CidrIp: '0.0.0.0/0' }]
          }
        },
        ...ssmRoleResources('TestApps'),
        TestAppsInstance: {
          Type: 'AWS::EC2::Instance',
          Properties: {
            ImageId: imageId,
            InstanceType: instanceType || TEST_APPS_INSTANCE_TYPE,
            ...(keyPairName ? { KeyName: keyPairName } : {}),
            IamInstanceProfile: { Ref: 'TestAppsInstanceProfile' },
            SubnetId: subnetId,
            SecurityGroupIds: [{ Ref: 'TestAppsSecurityGroup' }],
            BlockDeviceMappings: [{ DeviceName: '/dev/sda1', Ebs: { VolumeSize: 40, VolumeType: 'gp3' } }],
            UserData: userDataScript,
            Tags: [{ Key: 'Name', Value: 'zpa-shield-test-apps' }]
          }
        }
      },
      Outputs: {
        InstanceId: { Value: { Ref: 'TestAppsInstance' } },
        PrivateIp: { Value: { 'Fn::GetAtt': ['TestAppsInstance', 'PrivateIp'] } }
      }
    });

    const finalStackName = stackName || 'zpa-test-apps';
    const reused = await createStackOrReuse(cfn, {
      StackName: finalStackName,
      TemplateBody: template,
      Capabilities: ['CAPABILITY_IAM']
    });

    // User data only runs on first boot. On an existing stack, re-run the apps script over SSM
    // so new endpoints actually start; if the instance has no SSM role, say so plainly.
    let rerun = null;
    if (reused) {
      try {
        const { ssm } = awsClients(accessKeyId, secretAccessKey, region, sessionToken, awsProfile);
        const st = await stackOutputs(cfn, finalStackName);
        const m = st.instanceId ? await isManaged(ssm, st.instanceId) : { managed: false, pingStatus: 'NoInstance' };
        if (m.managed) {
          const b64 = Buffer.from(generateTestAppsScript()).toString('base64');
          await runShell(ssm, st.instanceId, ['pkill -f "bash /opt/zpa-shield-testapps.sh" || true', 'pkill -f "/var/lib/cloud/instance/scripts/" || true', // stop any earlier copy (e.g. a hung 1.8.4 first-boot run)
      `echo ${b64} | base64 -d > /opt/zpa-shield-testapps.sh`, 'chmod +x /opt/zpa-shield-testapps.sh', 'nohup bash /opt/zpa-shield-testapps.sh > /var/log/zpa-shield-testapps.log 2>&1 &', 'echo started'], { timeoutMs: 30000, comment: 'zpa-shield rerun apps' });
          rerun = { started: true, message: 'Existing stack kept; the apps script is re-running on the instance through Systems Manager so any new endpoints start. Allow 5–8 minutes.' };
        } else {
          rerun = { started: false, needsRecreate: true, message: `Existing stack kept, but its instance isn’t reachable through Systems Manager (${m.pingStatus}) — it was created before the wizard added an SSM role — so the apps script can’t be re-run and new endpoints will NOT start. To get them: delete the ${finalStackName} stack (CloudFormation, or Done → Tear Down) and click Deploy again; the new instance starts everything on first boot. Then re-run Publish because the IP changes.` };
        }
      } catch (e) { rerun = { started: false, message: `Existing stack kept; couldn’t re-run the apps script: ${e.message}` }; }
    }

    res.json({
      stackName: finalStackName, reused, rerun,
      consoleUrl: `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks`,
      apps: TEST_APPS.map(a => ({ name: a.name.replace('ZPA Shield - ', ''), port: a.port, scheme: a.scheme }))
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/aws/deploy-traffic-connector — an ordinary App Connector in the VPC that
// forwards user traffic to the test apps (outbound 443 to Zscaler, plus the VPC)
router.post('/deploy-traffic-connector', async (req, res) => {
  const { accessKeyId, secretAccessKey, sessionToken, awsProfile, region, vpcId, subnetId, keyPairName, provisioningKey, stackName } = req.body;
  try {
    if (!provisioningKey) throw new Error('No provisioning key for the traffic connector');
    const { cfn, ec2 } = awsClients(accessKeyId, secretAccessKey, region, sessionToken, awsProfile);
    const imageId = await rhel9Ami(ec2, region);
    const cidr = await vpcCidr(ec2, vpcId);
    const template = JSON.stringify({
      AWSTemplateFormatVersion: '2010-09-09',
      Description: 'ZPA Shield - App Connector for the test apps',
      Resources: {
        TrafficConnectorSecurityGroup: {
          Type: 'AWS::EC2::SecurityGroup',
          Properties: {
            GroupDescription: 'ZPA traffic connector - outbound 443 plus the VPC, no inbound',
            VpcId: vpcId,
            SecurityGroupEgress: [
              { IpProtocol: 'tcp', FromPort: 443, ToPort: 443, CidrIp: '0.0.0.0/0', Description: 'Zscaler cloud and repos' },
              { IpProtocol: '-1', CidrIp: cidr, Description: 'Apps inside the VPC' },
            ],
          },
        },
        ...ssmRoleResources('TrafficConnector'),
        TrafficConnectorInstance: {
          Type: 'AWS::EC2::Instance',
          Properties: {
            ImageId: imageId,
            InstanceType: 't3.medium',
            ...(keyPairName ? { KeyName: keyPairName } : {}),
            IamInstanceProfile: { Ref: 'TrafficConnectorInstanceProfile' },
            SubnetId: subnetId,
            SecurityGroupIds: [{ Ref: 'TrafficConnectorSecurityGroup' }],
            UserData: Buffer.from(withSsmAgent(generateConnectorScript({ provisioningKey }))).toString('base64'),
            Tags: [{ Key: 'Name', Value: 'zpa-traffic-connector' }],
          },
        },
      },
      Outputs: {
        InstanceId: { Value: { Ref: 'TrafficConnectorInstance' } },
        PrivateIp: { Value: { 'Fn::GetAtt': ['TrafficConnectorInstance', 'PrivateIp'] } },
      },
    });
    const finalStackName = stackName || 'zpa-traffic-connector';
    const reused = await createStackOrReuse(cfn, { StackName: finalStackName, TemplateBody: template, Capabilities: ['CAPABILITY_IAM'] });
    res.json({ stackName: finalStackName, reused });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Status & readiness probes (Systems Manager) ─────────────────────────────────
async function stackOutputs(cfn, stackName) {
  const r = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
  const s = r.Stacks[0];
  const out = Object.fromEntries((s.Outputs || []).map(o => [o.OutputKey, o.OutputValue]));
  return { status: s.StackStatus, created: s.CreationTime, instanceId: out.InstanceId, privateIp: out.PrivateIp };
}
const since = (t) => Math.round((Date.now() - new Date(t).getTime()) / 1000);

// GET /api/aws/instance-managed?stackName= — can we run commands on that stack's instance?
router.get('/instance-managed', async (req, res) => {
  const { accessKeyId, secretAccessKey, sessionToken, awsProfile, region, stackName } = req.query;
  try {
    const { cfn, ssm } = awsClients(accessKeyId, secretAccessKey, region, sessionToken, awsProfile);
    const st = await stackOutputs(cfn, stackName);
    const m = st.instanceId ? await isManaged(ssm, st.instanceId) : { managed: false, pingStatus: 'NoInstance' };
    res.json({ ...st, ...m, ageSeconds: st.created ? since(st.created) : null });
  } catch (err) { res.status(400).json({ error: credentialError(err) }); }
});

// POST /api/aws/probe-test-apps — from the App Scanner instance (it has SSM and is the thing
// that must reach the apps), curl every test endpoint and report docker/memory on the apps VM
// when that VM is itself managed.
router.post('/probe-test-apps', async (req, res) => {
  const { accessKeyId, secretAccessKey, sessionToken, awsProfile, region, ip, scannerStack = 'zpa-app-scanner', testAppsStack = 'zpa-test-apps', launchedAt } = req.body;
  try {
    if (!ip) throw new Error('No test-apps IP yet');
    const { cfn, ssm } = awsClients(accessKeyId, secretAccessKey, region, sessionToken, awsProfile);
    const apps = await stackOutputs(cfn, testAppsStack).catch(() => ({}));
    const ageSeconds = apps.created ? since(apps.created) : (launchedAt ? since(launchedAt) : null);

    // Which managed instance will do the probing? Prefer the scanner (the path that matters).
    let prober = null, proberName = '';
    for (const [name, stack] of [['App Scanner', scannerStack], ['test apps VM', testAppsStack]]) {
      try { const o = await stackOutputs(cfn, stack); if (o.instanceId && (await isManaged(ssm, o.instanceId)).managed) { prober = o.instanceId; proberName = name; break; } } catch { /* next */ }
    }
    const est = timings.get('testapps.all'), estCore = timings.get('testapps.core');
    if (!prober) {
      return res.json({ ok: false, reason: 'no-prober', ageSeconds, estimate: est,
        message: 'Neither the App Scanner nor the test-apps VM is reachable through Systems Manager yet, so the wizard can’t probe the endpoints from inside the VPC. A freshly launched instance registers ~2 minutes after boot; instances from wizard versions before 1.8 have no SSM role (recreate the stack to get one). You can still check from a Client Connector device.',
        endpoints: TEST_APPS.map(a => ({ ...a, url: `${a.scheme}://${ip}${(a.scheme==='http'&&a.port===80)||(a.scheme==='https'&&a.port===443)?'':':'+a.port}/`, code: null, ok: null })) });
    }
    const curls = TEST_APPS.map(a => `echo "EP ${a.key} $(curl -sk -o /dev/null -m 6 -w '%{http_code}' ${a.scheme}://${ip}:${a.port}/ || echo 000)"`);
    const localCmds = ['echo "DOCKER $(docker ps -a --format \'{{.Names}}={{.Status}}\' 2>/dev/null | tr \'\\n\' \';\')"', 'echo "MEM $(free -m | awk \'/Mem:/{print $3\"/\"$2}\')"',
      'echo "WARNINGS_BEGIN"; grep -h "WARNING\\|SCRIPT FAILED" /var/log/zpa-shield-status.log /var/log/zpa-shield-testapps.log /var/log/cloud-init-output.log 2>/dev/null | sort -u | tail -n 12; echo "WARNINGS_END"',
      'echo "LASTLINE $(grep -h "===\\|Test apps ready" /var/log/zpa-shield-testapps.log /var/log/cloud-init-output.log 2>/dev/null | tail -n 1)"'];
    let out = await runShell(ssm, prober, [...curls, ...(proberName === 'test apps VM' ? localCmds : [])], { timeoutMs: 90000, comment: 'zpa-shield probe' });
    // Probing from the scanner but the apps VM is also managed: fetch its container state too.
    if (proberName !== 'test apps VM' && apps.instanceId && (await isManaged(ssm, apps.instanceId).catch(() => ({}))).managed) {
      const o2 = await runShell(ssm, apps.instanceId, localCmds, { timeoutMs: 60000, comment: 'zpa-shield apps state' }).catch(() => null);
      if (o2) out = { ...out, stdout: out.stdout + '\n' + o2.stdout };
    }
    const codes = Object.fromEntries([...out.stdout.matchAll(/^EP (\S+) (\d{3})$/gm)].map(m => [m[1], m[2]]));
    const endpoints = TEST_APPS.map(a => {
      const code = codes[a.key] || '000';
      const ok = /^[1-5]\d\d$/.test(code) && code !== '000';
      const url = `${a.scheme}://${ip}${(a.scheme==='http'&&a.port===80)||(a.scheme==='https'&&a.port===443)?'':':'+a.port}/`;
      return { ...a, url, code, ok };
    });
    const docker = (out.stdout.match(/^DOCKER (.*)$/m) || [])[1] || '';
    const mem = (out.stdout.match(/^MEM (.*)$/m) || [])[1] || '';
    const warnings = ((out.stdout.match(/WARNINGS_BEGIN\n([\s\S]*?)WARNINGS_END/) || [])[1] || '').split('\n').map(s => s.trim()).filter(Boolean);
    const scriptPhase = (out.stdout.match(/^LASTLINE (.*)$/m) || [])[1]?.replace(/=/g, '').trim() || '';
    const core = endpoints.filter(e => e.key === 'dvwa' || e.key === 'juice');
    const allUp = endpoints.every(e => e.ok), coreUp = core.every(e => e.ok);
    if (allUp && ageSeconds) timings.record('testapps.all', ageSeconds);
    else if (coreUp && ageSeconds) timings.record('testapps.core', ageSeconds);
    if (allUp && req.body.notify) notify('ZPA Shield Deployer', `All ${endpoints.length} test endpoints are answering at ${ip}`);
    res.json({ ok: true, probedFrom: proberName, endpoints, docker, mem, warnings, scriptPhase, ageSeconds, allUp, coreUp, estimate: est, estimateCore: estCore,
      slow: ageSeconds && !allUp && ageSeconds > est.max });
  } catch (err) { res.status(400).json({ error: err.code === 'NOT_MANAGED' ? err.message : credentialError(err) }); }
});

// POST /api/aws/rerun-test-apps — the apps script only runs on first boot (user data), so a
// redeploy on an existing stack changes nothing. Re-run it through Systems Manager instead.
router.post('/rerun-test-apps', async (req, res) => {
  const { accessKeyId, secretAccessKey, sessionToken, awsProfile, region, stackName = 'zpa-test-apps' } = req.body;
  try {
    const { cfn, ssm } = awsClients(accessKeyId, secretAccessKey, region, sessionToken, awsProfile);
    const st = await stackOutputs(cfn, stackName);
    if (!st.instanceId) throw new Error(`Stack ${stackName} has no instance`);
    const m = await isManaged(ssm, st.instanceId);
    if (!m.managed) return res.status(409).json({ error: `The test-apps instance isn’t reachable through Systems Manager (${m.pingStatus}), so the wizard can’t re-run the apps script on it. This instance was created without an SSM role (wizard < 1.8). To get the new apps: delete the ${stackName} stack (Done → Tear Down, or CloudFormation) and click Deploy again — the new stack has Session Manager and starts all endpoints on first boot. Then re-run Publish (the IP changes).`, needsRecreate: true });
    const script = generateTestAppsScript();
    const b64 = Buffer.from(script).toString('base64');
    const out = await runShell(ssm, st.instanceId, [
      'pkill -f "bash /opt/zpa-shield-testapps.sh" || true', 'pkill -f "/var/lib/cloud/instance/scripts/" || true', // stop any earlier copy (e.g. a hung 1.8.4 first-boot run)
      `echo ${b64} | base64 -d > /opt/zpa-shield-testapps.sh`, 'chmod +x /opt/zpa-shield-testapps.sh',
      'nohup bash /opt/zpa-shield-testapps.sh > /dev/null 2>&1 &', 'echo started', // the script tees itself to /var/log/zpa-shield-testapps.log
    ], { timeoutMs: 30000, comment: 'zpa-shield rerun apps' });
    res.json({ started: /started/.test(out.stdout), instanceId: st.instanceId, privateIp: st.privateIp, log: '/var/log/zpa-shield-testapps.log' });
  } catch (err) { res.status(400).json({ error: err.code === 'NOT_MANAGED' ? err.message : credentialError(err) }); }
});

// POST /api/aws/teardown — delete the stacks this wizard created (and the SSM key parameter).
// Only stack names from the wizard are accepted. Deletion runs in AWS; status is polled via /stack-status.
const WIZARD_STACKS = ['zpa-traffic-connector', 'zpa-app-scanner', 'zpa-test-apps'];
router.post('/teardown', async (req, res) => {
  const { accessKeyId, secretAccessKey, sessionToken, awsProfile, region, stacks = WIZARD_STACKS, ssmParamName } = req.body;
  const results = [];
  try {
    const { cfn, ssm } = awsClients(accessKeyId, secretAccessKey, region, sessionToken, awsProfile);
    for (const name of stacks) {
      if (!WIZARD_STACKS.includes(name) && !/^zpa-/.test(name)) { results.push({ item: name, ok: false, detail: 'not a wizard stack' }); continue; }
      try {
        await cfn.send(new DescribeStacksCommand({ StackName: name }));
        await cfn.send(new DeleteStackCommand({ StackName: name }));
        results.push({ item: `Stack ${name}`, ok: true, detail: 'deletion started' });
      } catch (e) {
        if (/does not exist/i.test(e.message || '')) results.push({ item: `Stack ${name}`, ok: true, detail: 'already gone' });
        else results.push({ item: `Stack ${name}`, ok: false, detail: e.message });
      }
    }
    if (ssmParamName) {
      try { await ssm.send(new DeleteParameterCommand({ Name: ssmParamName })); results.push({ item: `SSM parameter ${ssmParamName}`, ok: true, detail: 'deleted' }); }
      catch (e) { results.push({ item: `SSM parameter ${ssmParamName}`, ok: /ParameterNotFound/.test(e.name || e.message || ''), detail: /ParameterNotFound/.test(e.name || e.message || '') ? 'already gone' : e.message }); }
    }
    res.json({ results });
  } catch (err) {
    res.status(400).json({ error: credentialError(err, awsProfile), results });
  }
});

// POST /api/aws/open-scan-paths — add the VPC-internal rules to stacks deployed before
// the templates had them. Safe to run repeatedly (existing rules are left alone).
router.post('/open-scan-paths', async (req, res) => {
  const { accessKeyId, secretAccessKey, sessionToken, awsProfile, region, vpcId, testAppsStack = 'zpa-test-apps', scannerStack = 'zpa-app-scanner' } = req.body;
  const done = [];
  try {
    const { cfn, ec2 } = awsClients(accessKeyId, secretAccessKey, region, sessionToken, awsProfile);
    const cidr = await vpcCidr(ec2, vpcId);
    const sgOf = async (stack, logicalId) => {
      try {
        const r = await cfn.send(new DescribeStackResourceCommand({ StackName: stack, LogicalResourceId: logicalId }));
        return r.StackResourceDetail?.PhysicalResourceId;
      } catch (e) { return null; }
    };
    const ignoreDup = (e) => { if (!/Duplicate/i.test(`${e.name} ${e.Code} ${e.message}`)) throw e; };
    const perm = ({ Description, CidrIp, ...p }) => ({ ...p, IpRanges: [{ CidrIp, Description }] });

    const appsSg = await sgOf(testAppsStack, 'TestAppsSecurityGroup');
    if (appsSg) {
      for (const rule of testAppsIngress(cidr)) {
        await ec2.send(new AuthorizeSecurityGroupIngressCommand({ GroupId: appsSg, IpPermissions: [perm(rule)] })).catch(ignoreDup);
      }
      done.push(`Test apps (${appsSg}): allow ports ${TEST_APP_PORTS.join(' and ')} from ${cidr}`);
    } else done.push(`No ${testAppsStack} stack found, skipped`);

    const scanSg = await sgOf(scannerStack, 'ZPAScannerSecurityGroup');
    if (scanSg) {
      await ec2.send(new AuthorizeSecurityGroupEgressCommand({ GroupId: scanSg, IpPermissions: [perm(scannerEgressToVpc(cidr))] })).catch(ignoreDup);
      done.push(`App Scanner (${scanSg}): allow outbound to ${cidr}`);
    } else done.push(`No ${scannerStack} stack found, skipped`);

    res.json({ cidr, done });
  } catch (err) {
    res.status(400).json({ error: err.message, done });
  }
});

module.exports = router;
