const express = require('express');
const router = express.Router();
const { CloudFormationClient, CreateStackCommand, DescribeStacksCommand, DescribeStackEventsCommand, DeleteStackCommand, DescribeStackResourceCommand } = require('@aws-sdk/client-cloudformation');
const { EC2Client, DescribeVpcsCommand, DescribeSubnetsCommand, DescribeKeyPairsCommand, DescribeImagesCommand, AuthorizeSecurityGroupIngressCommand, AuthorizeSecurityGroupEgressCommand } = require('@aws-sdk/client-ec2');
const { SSMClient, PutParameterCommand } = require('@aws-sdk/client-ssm');
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
//   test apps  <- tcp 80 / 3000 from the VPC (scanner + App Connectors reach apps directly)
//   scanner    -> anything in the VPC (it probes the apps' ports)
const TEST_APP_PORTS = [80, 3000];
function testAppsIngress(cidr) {
  return TEST_APP_PORTS.map(p => ({ IpProtocol: 'tcp', FromPort: p, ToPort: p, CidrIp: cidr, Description: `Test app port ${p} from the VPC` }));
}
function scannerEgressToVpc(cidr) {
  return { IpProtocol: '-1', CidrIp: cidr, Description: 'Scan apps inside the VPC' };
}

function awsClients(accessKeyId, secretAccessKey, region, sessionToken) {
  const credentials = { accessKeyId: (accessKeyId || '').trim(), secretAccessKey: (secretAccessKey || '').trim() };
  if (sessionToken && sessionToken.trim()) credentials.sessionToken = sessionToken.trim();
  const creds = { credentials, region };
  return {
    cfn: new CloudFormationClient(creds),
    ec2: new EC2Client(creds),
    ssm: new SSMClient(creds)
  };
}

// GET /api/aws/resources
router.get('/resources', async (req, res) => {
  const { accessKeyId, secretAccessKey, sessionToken, region } = req.query;
  try {
    const { ec2 } = awsClients(accessKeyId, secretAccessKey, region, sessionToken);
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
    res.status(400).json({ error: err.message });
  }
});

// POST /api/aws/deploy — App Scanner
router.post('/deploy', async (req, res) => {
  const { accessKeyId, secretAccessKey, sessionToken, region, vpcId, subnetId, keyPairName,
    instanceType, ebsSize, ssmParamName, provisioningKey, stackName } = req.body;
  try {
    const { cfn, ssm, ec2 } = awsClients(accessKeyId, secretAccessKey, region, sessionToken);
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
  const { stackName, region, accessKeyId, secretAccessKey, sessionToken } = req.query;
  try {
    const { cfn } = awsClients(accessKeyId, secretAccessKey, region, sessionToken);
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
  const { accessKeyId, secretAccessKey, sessionToken, region, vpcId, subnetId, keyPairName, instanceType, stackName } = req.body;
  try {
    const { cfn, ec2 } = awsClients(accessKeyId, secretAccessKey, region, sessionToken);
    const imageId = await rhel9Ami(ec2, region);

    // Same script as CloudShare: Docker CE (RHEL 9's own "docker" package is podman,
    // which has no docker service) + DVWA + Juice Shop
    const userDataScript = Buffer.from(generateTestAppsScript()).toString('base64');
    const cidr = await vpcCidr(ec2, vpcId);

    const template = JSON.stringify({
      AWSTemplateFormatVersion: '2010-09-09',
      Description: 'ZPA Shield Test Apps - DVWA + OWASP Juice Shop',
      Resources: {
        TestAppsSecurityGroup: {
          Type: 'AWS::EC2::SecurityGroup',
          Properties: {
            GroupDescription: 'ZPA Test Apps - ports 80 and 3000 from inside the VPC only',
            VpcId: vpcId,
            SecurityGroupIngress: testAppsIngress(cidr),
            SecurityGroupEgress: [{ IpProtocol: '-1', CidrIp: '0.0.0.0/0' }]
          }
        },
        TestAppsInstance: {
          Type: 'AWS::EC2::Instance',
          Properties: {
            ImageId: imageId,
            InstanceType: instanceType || 't3.medium',
            KeyName: keyPairName,
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
    await createStackOrReuse(cfn, {
      StackName: finalStackName,
      TemplateBody: template,
      Capabilities: ['CAPABILITY_IAM']
    });

    res.json({
      stackName: finalStackName,
      consoleUrl: `https://${region}.console.aws.amazon.com/cloudformation/home?region=${region}#/stacks`,
      apps: [
        { name: 'DVWA', port: 80, domain: 'dvwa.internal' },
        { name: 'Juice Shop', port: 3000, domain: 'juiceshop.internal' }
      ]
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/aws/deploy-traffic-connector — an ordinary App Connector in the VPC that
// forwards user traffic to the test apps (outbound 443 to Zscaler, plus the VPC)
router.post('/deploy-traffic-connector', async (req, res) => {
  const { accessKeyId, secretAccessKey, sessionToken, region, vpcId, subnetId, keyPairName, provisioningKey, stackName } = req.body;
  try {
    if (!provisioningKey) throw new Error('No provisioning key for the traffic connector');
    const { cfn, ec2 } = awsClients(accessKeyId, secretAccessKey, region, sessionToken);
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
        TrafficConnectorInstance: {
          Type: 'AWS::EC2::Instance',
          Properties: {
            ImageId: imageId,
            InstanceType: 't3.medium',
            KeyName: keyPairName,
            SubnetId: subnetId,
            SecurityGroupIds: [{ Ref: 'TrafficConnectorSecurityGroup' }],
            UserData: Buffer.from(generateConnectorScript({ provisioningKey })).toString('base64'),
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
    const reused = await createStackOrReuse(cfn, { StackName: finalStackName, TemplateBody: template });
    res.json({ stackName: finalStackName, reused });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/aws/open-scan-paths — add the VPC-internal rules to stacks deployed before
// the templates had them. Safe to run repeatedly (existing rules are left alone).
router.post('/open-scan-paths', async (req, res) => {
  const { accessKeyId, secretAccessKey, sessionToken, region, vpcId, testAppsStack = 'zpa-test-apps', scannerStack = 'zpa-app-scanner' } = req.body;
  const done = [];
  try {
    const { cfn, ec2 } = awsClients(accessKeyId, secretAccessKey, region, sessionToken);
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
