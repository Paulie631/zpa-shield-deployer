# ZPA Shield Deployer

A wizard UI for deploying **ZPA Autonomous Application Shield** to AWS or CloudShare — with test app deployment (DVWA + OWASP Juice Shop) built in.

![ZPA Shield Deployer](https://img.shields.io/badge/ZPA-Shield%20Deployer-0066CC?style=for-the-badge&logo=zscaler)
![Version](https://img.shields.io/github/v/release/Paulie631/zpa-shield-deployer?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)

---

## What it does

A 9-step guided wizard that automates the full ZPA App Shield deployment:

| Step | What happens |
|------|-------------|
| 1 | Connect to your ZPA tenant (API key or OAuth) |
| 2 | Choose AWS or CloudShare |
| 3 | Configure your AWS environment (VPC, subnet, key pair) or CloudShare VM |
| 4 | Enter ZPA provisioning key + connector group |
| 5 | **AWS:** Launch App Scanner via CloudFormation + SSM · **CloudShare:** Download pre-filled setup script |
| 6 | Deploy DVWA + OWASP Juice Shop as vulnerable test targets |
| 7 | Configure scan (probing level, app segments, schedule) |
| 8 | Manual ZPA portal checklist with deep links |
| 9 | Summary + links to ZPA Shield, scans, and AppProtection logs |

---

## Prerequisites

- Node.js 18+
- npm 9+
- A ZPA tenant with Autonomous Application Shield enabled
- AWS account (for AWS path) with permissions to create EC2, CloudFormation, SSM, and IAM resources

---

## Quick Start

### Option A — Download the latest release (recommended)

1. Go to [Releases](../../releases/latest) and download `zpa-shield-deployer-v*.zip`
2. Unzip and open a terminal in the folder
3. Run:

```bash
npm run install:all
npm run dev
```

4. Open **http://localhost:3000** in your browser

### Option B — Clone from source

```bash
git clone https://github.com/Paulie631/zpa-shield-deployer.git
cd zpa-shield-deployer
npm run install:all
npm run dev
```

---

## Architecture

```
Frontend:  React + Vite  →  http://localhost:3000
Backend:   Express       →  http://localhost:3001

API Routes:
  /api/zpa/validate          Validate ZPA credentials, fetch connector groups + app segments
  /api/zpa/scan              Create scan profile + scan
  /api/zpa/app-segments      Create ZPA app segments
  /api/aws/resources         Fetch VPCs, subnets, key pairs from EC2
  /api/aws/deploy            Launch App Scanner CloudFormation stack
  /api/aws/stack-status      Poll CFN stack status
  /api/aws/deploy-test-apps  Launch DVWA + Juice Shop EC2 instance
  /api/cloudshare/script     Generate pre-filled bash setup script
```

---

## Security

- **Credentials are never stored** — AWS keys, ZPA API keys, and provisioning keys are passed per-request only and never written to disk or logs
- AWS provisioning key is stored in **SSM Parameter Store as a SecureString**
- The App Scanner EC2 security group allows **outbound 443 only** — no inbound rules
- Test app EC2 instance has **no inbound security group rules** — access is via ZPA only

---

## Test Applications

The wizard can deploy two intentionally vulnerable apps for scanning:

| App | Port | Vulnerabilities |
|-----|------|----------------|
| [DVWA](https://github.com/digininja/DVWA) | 80 | SQLi, XSS, CSRF, File Inclusion, Command Injection, Path Traversal |
| [OWASP Juice Shop](https://github.com/juice-shop/juice-shop) | 3000 | 100+ OWASP Top 10 vulns — realistic e-commerce app |

---

## AWS Resources Created

### App Scanner Stack (`zpa-app-scanner`)
- EC2 instance: RHEL 9, c5.4xlarge (configurable), 200 GB gp3
- IAM role + instance profile (SSM GetParameter only)
- Security group (outbound 443 only)
- SSM SecureString parameter (provisioning key)

### Test Apps Stack (`zpa-test-apps`)
- EC2 instance: RHEL 9, t3.medium, 40 GB gp3
- Security group (outbound only)
- DVWA + Juice Shop via Docker (auto-start on boot)

> ⚠️ **AMI Note:** Default AMI (`ami-0fe630eb857a6ec83`) is RHEL 9 for `us-east-1`. Update for other regions: [Red Hat AMI finder](https://access.redhat.com/solutions/15356)

---

## ZPA App Scanner Requirements

| Resource | Minimum |
|----------|---------|
| CPU | 16 cores |
| Memory | 16 GB |
| Free disk in /var | 120 GB |
| OS | RHEL 9.x (RPM install only) |
| Docker | Required |
| Network | Outbound TCP/443 to Zscaler PSE endpoints |

> Zscaler marketplace/prebuilt images are **not supported**. Must be RPM install on RHEL 9.

---

## License

MIT — see [LICENSE](LICENSE)

---

## Related

- [ZPA Documentation](https://help.zscaler.com/zpa)
- [aiguard-se-kit](https://github.com/Paulie631/aiguard-se-kit)
- [zscaler-pov-kit](https://github.com/Paulie631/zscaler-pov-kit)
