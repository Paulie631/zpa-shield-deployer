require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

// Only the wizard UI (served on localhost:3000) may call this API. Without this, any website
// open in the browser could drive the local server (credentials, updater, cloud resources).
const ALLOWED_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.has(origin)) }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ error: 'Forbidden origin' });
  next();
});
app.use(express.json({ limit: '2mb' }));

// Secrets stay on this machine: blank secret fields are filled from ~/.zpa-shield/secrets.json
const { fillFromVault } = require('./lib/vault');
app.use('/api/vault', require('./routes/vault'));
app.use(fillFromVault);

app.use('/api/zpa', require('./routes/zpa'));
app.use('/api/aws', require('./routes/aws'));
app.use('/api/cloudshare', require('./routes/cloudshare'));
app.use('/api/testapps', require('./routes/testapps'));
app.use('/api/update', require('./routes/update'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`ZPA Shield Deployer backend running on http://localhost:${PORT}`));
