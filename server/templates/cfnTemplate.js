function generateCfnTemplate({ vpcId, subnetId, keyPairName, instanceType, ebsSize, script, ssmParamName, imageId }) {
  const userDataB64 = Buffer.from(script).toString('base64');

  return JSON.stringify({
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'ZPA Autonomous Application Shield — App Scanner (RPM on RHEL 9). NOTE: Update ImageId per region. Find RHEL 9 AMIs at https://access.redhat.com/solutions/15356',
    Resources: {
      ZPAScannerRole: {
        Type: 'AWS::IAM::Role',
        Properties: {
          AssumeRolePolicyDocument: {
            Version: '2012-10-17',
            Statement: [{ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' }]
          },
          Policies: [{
            PolicyName: 'ZPAScannerSSMPolicy',
            PolicyDocument: {
              Version: '2012-10-17',
              Statement: [{
                Effect: 'Allow',
                Action: ['ssm:GetParameter', 'ssm:GetParameters'],
                Resource: `arn:aws:ssm:*:*:parameter${ssmParamName}`
              }]
            }
          }]
        }
      },
      ZPAScannerInstanceProfile: {
        Type: 'AWS::IAM::InstanceProfile',
        Properties: { Roles: [{ Ref: 'ZPAScannerRole' }] }
      },
      ZPAScannerSecurityGroup: {
        Type: 'AWS::EC2::SecurityGroup',
        Properties: {
          GroupDescription: 'ZPA App Scanner — outbound 443 only (no inbound required)',
          VpcId: vpcId,
          SecurityGroupEgress: [
            { IpProtocol: 'tcp', FromPort: 443, ToPort: 443, CidrIp: '0.0.0.0/0', Description: 'Zscaler PSE + repo access' }
          ]
        }
      },
      ZPAScannerInstance: {
        Type: 'AWS::EC2::Instance',
        Properties: {
          ImageId: imageId || 'ami-0fe630eb857a6ec83',
          InstanceType: instanceType || 'c5.4xlarge',
          KeyName: keyPairName,
          SubnetId: subnetId,
          IamInstanceProfile: { Ref: 'ZPAScannerInstanceProfile' },
          SecurityGroupIds: [{ Ref: 'ZPAScannerSecurityGroup' }],
          BlockDeviceMappings: [{
            DeviceName: '/dev/sda1',
            Ebs: { VolumeSize: parseInt(ebsSize) || 200, VolumeType: 'gp3', DeleteOnTermination: true }
          }],
          UserData: userDataB64,
          Tags: [{ Key: 'Name', Value: 'zpa-app-scanner' }, { Key: 'Purpose', Value: 'ZPA-App-Shield-Scanner' }]
        }
      }
    },
    Outputs: {
      InstanceId: { Description: 'App Scanner EC2 Instance ID', Value: { Ref: 'ZPAScannerInstance' } },
      PrivateIp: { Description: 'Private IP address', Value: { 'Fn::GetAtt': ['ZPAScannerInstance', 'PrivateIp'] } }
    }
  }, null, 2);
}

module.exports = { generateCfnTemplate };
