const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const https = require('https');

const REPO = 'Paulie631/zpa-shield-deployer';
const CURRENT_VERSION = require('../../package.json').version;
const APP_ROOT = path.resolve(__dirname, '../../');

// GET /api/update/check
// Checks GitHub releases for a newer version
router.get('/check', async (req, res) => {
  try {
    // Read version fresh each time (don't cache at require time)
    let currentVersion;
    try {
      const pkgPath = require('path').resolve(__dirname, '../../package.json');
      delete require.cache[require.resolve(pkgPath)];
      currentVersion = require(pkgPath).version;
    } catch (e) {
      currentVersion = CURRENT_VERSION;
    }

    const response = await axios.get(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      {
        headers: { 'User-Agent': 'zpa-shield-deployer', Accept: 'application/vnd.github+json' },
        timeout: 8000
      }
    );
    const latest = response.data;
    const latestVersion = latest.tag_name.replace(/^v/, '');
    const hasUpdate = compareVersions(latestVersion, currentVersion) > 0;

    res.json({
      currentVersion,
      latestVersion,
      hasUpdate,
      releaseNotes: latest.body || '',
      releaseName: latest.name || `v${latestVersion}`,
      publishedAt: latest.published_at,
      releaseUrl: latest.html_url,
      zipUrl: latest.assets?.find(a => a.name.endsWith('.zip'))?.browser_download_url || null
    });
  } catch (err) {
    // Return detailed error so the UI can show what actually went wrong
    const detail = err.response
      ? `GitHub API error ${err.response.status}: ${JSON.stringify(err.response.data)}`
      : err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND'
        ? `Network error (${err.code}) — check internet connection`
        : err.message;
    res.status(500).json({ error: detail });
  }
});

// POST /api/update/apply
// Downloads the new release zip, extracts it, reinstalls deps, restarts
router.post('/apply', async (req, res) => {
  const { zipUrl, latestVersion } = req.body;
  if (!zipUrl) return res.status(400).json({ error: 'No zip URL provided' });

  // Send immediate response — update happens async
  res.json({ status: 'updating', message: 'Update started. App will restart in ~30 seconds.' });

  // Run update async after response is sent
  setTimeout(async () => {
    try {
      const tmpZip = path.join(APP_ROOT, `../_update_${latestVersion}.zip`);
      const tmpExtract = path.join(APP_ROOT, `../_update_extract_${latestVersion}`);

      // 1. Download zip
      await downloadFile(zipUrl, tmpZip);

      // 2. Extract zip to temp dir
      fs.mkdirSync(tmpExtract, { recursive: true });
      execSync(`unzip -o "${tmpZip}" -d "${tmpExtract}"`, { stdio: 'pipe' });

      // 3. Find extracted folder (should be zpa-shield-deployer/)
      const extracted = fs.readdirSync(tmpExtract)[0];
      const extractedPath = path.join(tmpExtract, extracted);

      // 4. Sync source files (exclude node_modules, .env, .git)
      execSync(`rsync -av --exclude='node_modules' --exclude='.env' --exclude='.git' "${extractedPath}/" "${APP_ROOT}/"`, { stdio: 'pipe' });

      // 5. Update version in package.json (already updated from zip)

      // 6. npm install:all
      execSync(`cd "${APP_ROOT}" && npm run install:all`, { stdio: 'pipe' });

      // 7. Cleanup
      fs.rmSync(tmpZip, { force: true });
      fs.rmSync(tmpExtract, { recursive: true, force: true });

      // 8. Restart — works via pm2, nodemon, or direct process restart
      restartApp();
    } catch (err) {
      console.error('Update failed:', err.message);
    }
  }, 500);
});

// GET /api/update/version
router.get('/version', (req, res) => {
  res.json({ version: CURRENT_VERSION });
});

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = (u) => {
      https.get(u, { headers: { 'User-Agent': 'zpa-shield-deployer' } }, (response) => {
        if (response.statusCode === 302 || response.statusCode === 301) {
          return get(response.headers.location);
        }
        response.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
      }).on('error', reject);
    };
    get(url);
  });
}

function restartApp() {
  // Try pm2 first, then nodemon signal, then hard exit (process manager should restart)
  try {
    execSync('pm2 restart zpa-shield-deployer 2>/dev/null || true', { stdio: 'pipe' });
    return;
  } catch (e) {}
  // Fallback: exit and let the process manager restart
  console.log('Restarting process...');
  setTimeout(() => process.exit(0), 1000);
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

module.exports = router;
