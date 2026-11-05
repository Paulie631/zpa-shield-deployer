// Bash script that installs a standard (traffic-forwarding) ZPA App Connector on RHEL 9.
// Array of strings (not a template literal) so bash ${ } never clashes with JS.
// The provisioning key is passed base64-encoded so no character in it can break the script.
function generateConnectorScript({ provisioningKey }) {
  const keyB64 = Buffer.from(String(provisioningKey || ''), 'utf8').toString('base64')
  return [
    '#!/bin/bash',
    'set -euo pipefail',
    'trap \'echo "SCRIPT FAILED at line $LINENO"\' ERR',
    '',
    'echo "=== Step 1: Adding Zscaler EL9 repository ==="',
    'cat > /etc/yum.repos.d/zscaler.repo << \'ZSCALER_REPO\'',
    '[zscaler]',
    'name=Zscaler Private Access Repository',
    'baseurl=https://yum.private.zscaler.com/yum/el9',
    'enabled=1',
    'gpgcheck=1',
    'gpgkey=https://yum.private.zscaler.com/yum/el9/gpg',
    'ZSCALER_REPO',
    '',
    'echo "=== Step 2: Installing ZPA App Connector ==="',
    'dnf install -y zpa-connector',
    'systemctl stop zpa-connector || true',
    '',
    'echo "=== Step 3: Writing provisioning key ==="',
    'mkdir -p /opt/zscaler/var',
    `echo '${keyB64}' | base64 -d > /opt/zscaler/var/provision_key`,
    'chmod 644 /opt/zscaler/var/provision_key',
    '',
    'echo "=== Step 4: Starting ZPA App Connector ==="',
    'systemctl enable --now zpa-connector',
    'echo "Connector setup complete!"',
  ].join('\n')
}

module.exports = { generateConnectorScript }
