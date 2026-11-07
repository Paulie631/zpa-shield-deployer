// Run a shell script on an EC2 instance through Systems Manager (no SSH, no inbound ports).
// The instance needs the SSM agent and the AmazonSSMManagedInstanceCore role.
const { SendCommandCommand, GetCommandInvocationCommand, DescribeInstanceInformationCommand } = require('@aws-sdk/client-ssm');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Is the instance registered with Systems Manager? (It takes ~2 minutes after boot.)
async function isManaged(ssm, instanceId) {
  try {
    const r = await ssm.send(new DescribeInstanceInformationCommand({ Filters: [{ Key: 'InstanceIds', Values: [instanceId] }] }));
    const info = (r.InstanceInformationList || [])[0];
    return { managed: !!info && info.PingStatus === 'Online', pingStatus: info?.PingStatus || 'NotRegistered' };
  } catch (e) { return { managed: false, pingStatus: 'Unknown', error: e.message }; }
}

// Run commands; returns { stdout, stderr, status, exitCode }. Throws with a readable reason.
async function runShell(ssm, instanceId, commands, { timeoutMs = 120000, comment = 'zpa-shield' } = {}) {
  const { managed, pingStatus } = await isManaged(ssm, instanceId);
  if (!managed) {
    const err = new Error(`Instance ${instanceId} is not reachable through Systems Manager (status: ${pingStatus}). Instances created by wizard versions before 1.8 have no SSM role — recreate the stack to get one; a freshly booted instance needs ~2 minutes to register.`);
    err.code = 'NOT_MANAGED'; throw err;
  }
  const sent = await ssm.send(new SendCommandCommand({
    InstanceIds: [instanceId], DocumentName: 'AWS-RunShellScript', Comment: comment,
    Parameters: { commands: Array.isArray(commands) ? commands : [commands], executionTimeout: [String(Math.ceil(timeoutMs / 1000))] },
  }));
  const id = sent.Command.CommandId;
  const deadline = Date.now() + timeoutMs + 15000;
  let last;
  while (Date.now() < deadline) {
    await sleep(2500);
    try {
      last = await ssm.send(new GetCommandInvocationCommand({ CommandId: id, InstanceId: instanceId }));
    } catch (e) { if (/InvocationDoesNotExist/.test(e.name || e.message)) continue; throw e; }
    if (['Success', 'Failed', 'Cancelled', 'TimedOut'].includes(last.Status)) break;
  }
  if (!last) throw new Error('Systems Manager never reported the command');
  return { status: last.Status, exitCode: last.ResponseCode, stdout: last.StandardOutputContent || '', stderr: last.StandardErrorContent || '' };
}

module.exports = { isManaged, runShell };
