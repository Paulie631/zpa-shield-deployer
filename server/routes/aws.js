const express = require('express');
const router = express.Router();
const { CloudFormationClient, CreateStackCommand, DescribeStacksCommand } = require('@aws-sdk/client-cloudformation');
const { EC2Client, DescribeVpcsCommand, DescribeSubnetsCommand, DescribeKeyPairsCommand } = require('@aws-sdk/client-ec2');
const { SSMClient, PutParameterCommand } = require('@aws-sdk/client-ssm');
const { generateCfnTemplate } = require('../templates/cfnTemplate');
const { generateSetupScript } = require('../templates/setupScript');

function awsClients(accessKeyId, secretAccessKey, region) {
  const creds = { credentials: { accessKeyId, secretAccessKey }, region };
  return {
    cfn: new CloudFormationClient(creds),
    ec2: new EC2Client(creds),
    ssm: new SSMClient(creds)
  };
}

// GET /api/aws/resources
router.get('/resources', async (req, res) => {
  const { accessKeyId, secretAccessKey, region } = req.query;
  try {
    const { ec2 } = awsClients(accessKeyId, secretAccessKey, region);
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
  const { accessKeyId, secretAccessKey, region, vpcId, subnetId, keyPairName,
    instanceType, ebsSize, ssmParamName, provisioningKey, stackName } = req.body;
  try {
    const { cfn, ssm } = awsClients(accessKeyId, secretAccessKey, region);

    // Store provisioning key in SSM
    await ssm.send(new PutParameterCommand({
      Name: ssmParamName || '/zpa/provisioning-key',
      Value: provisioningKey,
      Type: 'SecureString',
      Overwrite: true
    }));

    const script = generateSetupScript({ ssmParamName: ssmParamName || '/zpa/provisioning-key', provisioningKey, region });
    const template = generateCfnTemplate({ vpcId, subnetId, keyPairName, instanceType, ebsSize, script, ssmParamName: ssmParamName || '/zpa/provisioning-key' });

    const finalStackName = stackName || 'zpa-app-scanner';
    await cfn.send(new CreateStackCommand({
      StackName: finalStackName,
      TemplateBody: template,
      Capabilities: ['CAPABILITY_IAM']
    }));

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
  const { stackName, region, accessKeyId, secretAccessKey } = req.query;
  try {
    const { cfn } = awsClients(accessKeyId, secretAccessKey, region);
    const r = await cfn.send(new DescribeStacksCommand({ StackName: stackName }));
    const stack = r.Stacks[0];
    res.json({
      status: stack.StackStatus,
      outputs: stack.Outputs || [],
      reason: stack.StackStatusReason || ''
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/aws/deploy-test-apps — DVWA + Juice Shop
router.post('/deploy-test-apps', async (req, res) => {
  const { accessKeyId, secretAccessKey, region, vpcId, subnetId, keyPairName, instanceType, stackName } = req.body;
  try {
    const { cfn } = awsClients(accessKeyId, secretAccessKey, region);

    const userDataScript = Buffer.from(`#!/bin/bash
set -euo pipefail
dnf install -y docker || yum install -y docker
systemctl start docker
systemctl enable docker
docker run -d --name dvwa --restart always -p 80:80 vulnerables/web-dvwa
docker run -d --name juiceshop --restart always -p 3000:3000 bkimminich/juice-shop
echo "Test apps deployed" > /tmp/testapps-done
`).toString('base64');

    const template = JSON.stringify({
      AWSTemplateFormatVersion: '2010-09-09',
      Description: 'ZPA Shield Test Apps - DVWA + OWASP Juice Shop',
      Resources: {
        TestAppsSecurityGroup: {
          Type: 'AWS::EC2::SecurityGroup',
          Properties: {
            GroupDescription: 'ZPA Test Apps - allow outbound only (ZPA handles inbound)',
            VpcId: vpcId,
            SecurityGroupEgress: [{ IpProtocol: '-1', CidrIp: '0.0.0.0/0' }]
          }
        },
        TestAppsInstance: {
          Type: 'AWS::EC2::Instance',
          Properties: {
            // RHEL 9 us-east-1 — update AMI per region: https://access.redhat.com/solutions/15356
            ImageId: 'ami-0fe630eb857a6ec83',
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
    await cfn.send(new CreateStackCommand({
      StackName: finalStackName,
      TemplateBody: template,
      Capabilities: ['CAPABILITY_IAM']
    }));

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

module.exports = router;
