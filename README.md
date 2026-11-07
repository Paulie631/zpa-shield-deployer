# ZPA Shield Deployer

A wizard UI for deploying **ZPA Autonomous Application Shield** to AWS or CloudShare — with test app deployment (DVWA, OWASP Juice Shop and WebGoat, each also behind TLS / on standard ports) built in.

![ZPA Shield Deployer](https://img.shields.io/badge/ZPA-Shield%20Deployer-0066CC?style=for-the-badge&logo=zscaler)
![Version](https://img.shields.io/github/v/release/Paulie631/zpa-shield-deployer?style=for-the-badge)
![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)

---

## What it does

A 9-step guided wizard that automates the full ZPA App Shield deployment:

| Step | What happens |
|------|-------------|
| 1 | Connect to your ZPA tenant (OneAPI/Zidentity, API key or OAuth) and enter the numeric ZPA Customer ID once |
| 2 | Choose AWS or CloudShare |
| 3 | Configure your AWS environment — pick an AWS CLI profile (SSO sessions refresh themselves) or paste keys — plus VPC and subnet (key pair optional — the instances run the Session Manager agent, so EC2 → Connect gives a shell); or pick your CloudShare VMs |
| 4 | Deploy the vulnerable test apps: DVWA, OWASP Juice Shop, WebGoat, plus an nginx TLS front door (six endpoints) |
| 5 | **Publish them through ZPA:** a traffic App Connector (deployed on AWS), app segments for both apps, and an access policy rule |
| 6 | **Verify access:** ZPA-side checks (connector online, segments, rule); a Zidentity check of the user you sign in to Client Connector with (exists, covered by the rule, Private Access entitlement — one click adds them to the `ZPA Shield Test Users` group, which you link to the Private Access entitlement once in the portal); then a CloudShare VM with Zscaler Client Connector opens both apps, plus a manual check |
| 7 | Create or pick the App Scanner's connector group + provisioning key |
| 8 | **AWS:** launch the App Scanner via CloudFormation (Session Manager enabled, so EC2 → Connect gives a shell) · **CloudShare:** run the setup script on the VM |
| 9 | **Scanner readiness** via the API — adds the App Scanner group to the test apps' server group, turns on Application Shield Scanning for the scanner connector (off for traffic connectors) and checks it's online; then configure the scan (ZPA has no scan API, so the wizard gives exact portal steps: Private Access → Autonomous App Shield → Scans) |
| 10 | Final Experience Center checklist with deep links (items already done through the API are marked) |
| 11 | Summary + links |

---

## Prerequisites

- Node.js 18+
- npm 9+
- A ZPA tenant with Autonomous Application Shield enabled (Private Access shows an *Autonomous App Shield* menu)
- In Experience Center (console.zscaler.com): a OneAPI client with the ZPA resource — **Administration → API → OneAPI → API Clients** — and the numeric ZPA tenant ID from **Administration → Administration → Private Access Tenant**
- AWS account (for AWS path) with permissions to create EC2, CloudFormation, SSM, and IAM resources

---

## Quick Start

### Option A — One-line installer (recommended)

**macOS / Linux:**
```bash
curl -sSL https://raw.githubusercontent.com/Paulie631/zpa-shield-deployer/main/install.sh | bash
```
Then start it:
```bash
bash ~/zpa-shield-deployer/start.sh
# macOS shortcut also created: zpa-shield
```

**Windows** — download [`install.bat`](../../releases/latest) from the release and double-click it.
A desktop shortcut is created automatically.

---

### Option B — Manual install

1. Go to [Releases](../../releases/latest) and download `zpa-shield-deployer-v*.zip`
2. Unzip and open a terminal in the folder:

```bash
npm run install:all
npm run dev
```

### Option C — Clone from source

```bash
git clone https://github.com/Paulie631/zpa-shield-deployer.git
cd zpa-shield-deployer
npm run install:all
npm run dev
```

---

Open **http://localhost:3000** in your browser.

## In-App Updates

Click the **🔄 v1.x.x** button in the top-right corner of the app header to check for updates.

When a new version is available:
- A orange dot badge appears on the version button
- Click it to see release notes
- Click **Install Update** — the app downloads, installs, and restarts automatically
- Refresh the browser after ~30 seconds

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
  /api/aws/deploy-test-apps  Launch the test-apps EC2 instance (DVWA, Juice Shop, WebGoat, nginx TLS)
  /api/cloudshare/script     Generate pre-filled bash setup script
```

---

## Security

- **Secrets never sit in the browser.** ZPA client secrets / API keys, the CloudShare API key and pasted AWS keys are kept by the local backend in `~/.zpa-shield/secrets.json` (owner-only, mode 600) and filled into requests server-side. Non-secret fields (IDs, tenant, region) are remembered in the browser. “Clear saved” removes both. With an AWS CLI profile, no AWS secret is stored by the wizard at all
- The local API only accepts requests from the wizard itself (`localhost:3000`), and the updater only installs this repo's own GitHub release zips
- AWS provisioning key is stored in **SSM Parameter Store as a SecureString**
- The App Scanner EC2 security group allows **outbound 443 only** — no inbound rules
- Test app EC2 instance has **no inbound security group rules** — access is via ZPA only

---

## Test Applications

The wizard deploys three OWASP training apps and three old mainstream servers on one VM (t3.large on AWS) and exposes them as **nine endpoints**, each with its own ZPA app segment. App Shield fingerprints by port, runs a TLS phase and matches CVEs by detected software version, so the same app on a standard port, behind TLS and on its native port gives the scanner far more to report than two bare HTTP ports did.

| Segment | Port | What's behind it |
|---------|------|------------------|
| ZPA Shield - DVWA | 80 | [DVWA](https://github.com/digininja/DVWA) on a dated Apache/PHP image |
| ZPA Shield - DVWA-TLS | 443 | nginx 1.18 (TLS 1.0–1.2, self-signed) → DVWA |
| ZPA Shield - Juice Shop | 3000 | [OWASP Juice Shop](https://github.com/juice-shop/juice-shop) v13.3.0 (2022) |
| ZPA Shield - Juice Shop-8080 | 8080 | nginx → Juice Shop on a standard web port (avoids the “ppp” fingerprint on 3000) |
| ZPA Shield - Juice Shop-TLS | 8443 | nginx TLS → Juice Shop |
| ZPA Shield - WebGoat | 8081 | [OWASP WebGoat](https://github.com/WebGoat/WebGoat) v2023.4 — a Java/Spring stack |
| ZPA Shield - Apache httpd 2.4.49 | 8082 | Official `httpd:2.4.49` image — a release with a well-known 2021 CVE that App Shield's own check confirms |
| ZPA Shield - Tomcat 8.5 | 8083 | `tomcat:8.5.0-jre8` — Java server fingerprint with a long version-CVE list |
| ZPA Shield - WordPress 4.9 | 8084 | `wordpress:4.9.0-php7.0-apache` + MySQL 5.7 (internal only); the installer is completed automatically |

Images are pinned to older builds on purpose (`server/lib/testApps.js`). To get more findings still: scan each segment separately at **High** intensity, and ask the AAS team about authenticated scanning — most of DVWA's and Juice Shop's intended flaws sit behind a login.

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
- DVWA, Juice Shop, WebGoat and an nginx TLS front door via Docker (auto-start on boot)

> ℹ️ **AMI:** the wizard looks up the latest official RHEL 9 AMI (Red Hat's AWS account) in your chosen region, so the AWS keys need `ec2:DescribeImages`.

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

## ZPA user sign-in (IdP) for the Verify step

Client Connector can only bring up Private Access if ZPA has an enabled IdP with **Single Sign-On: User** covering the user's email domain; otherwise ZCC shows *"Unable to verify the IdP configuration for this domain"*. The Verify step checks this. If the tenant has no user IdP (Zidentity end-user auth not enabled), a free Okta Integrator org works:

1. ZPA → Private Access Authentication → IdP Configuration → Add (name, your user domain) → Next → note the SP Entity ID and SP URL.
2. Okta (developer.okta.com/signup, Integrator Free Plan) → Directory → People → add the user (password set by admin) → Applications → Applications → Create App Integration → SAML 2.0: Single sign-on URL = SP URL, Audience URI = SP Entity ID, Name ID = EmailAddress, username = Okta username → assign the user → Sign On tab → save the Metadata URL page as XML.
3. Back in ZPA, upload that XML as the IdP metadata, Single Sign-On: User, Enabled. Edit the same IdP rather than recreating it — the SP URLs are tied to the IdP entry.
4. In ZCC, Log Out and sign in again; Okta will ask the user to enroll Okta Verify on first sign-in.

