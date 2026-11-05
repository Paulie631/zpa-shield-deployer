const express = require('express');
const router = express.Router();
const vault = require('../lib/vault');

// GET /api/vault — what's stored (never the secret values)
router.get('/', (req, res) => res.json({ ...vault.status(), file: vault.FILE }));

// PUT /api/vault/:kind — store/merge credentials for zpa | cloudshare | aws
router.put('/:kind', (req, res) => {
  try { res.json(vault.set(req.params.kind, req.body || {})); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// DELETE /api/vault/:kind — forget them
router.delete('/:kind', (req, res) => {
  try { vault.clear(req.params.kind); res.json({ cleared: true }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
