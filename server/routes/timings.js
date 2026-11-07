// Learned durations + desktop notifications (local only)
const express = require('express');
const timings = require('../lib/timings');
const { notify } = require('../lib/notify');
const router = express.Router();
router.get('/', (req, res) => res.json(timings.all()));
router.post('/record', (req, res) => { const { key, seconds } = req.body || {}; if (!key) return res.status(400).json({ error: 'key required' }); res.json(timings.record(key, Number(seconds))); });
router.post('/notify', (req, res) => { const { title = 'ZPA Shield Deployer', message = '' } = req.body || {}; notify(String(title).slice(0, 80), String(message).slice(0, 200)); res.json({ ok: true }); });
module.exports = router;
