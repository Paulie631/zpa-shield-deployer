const express = require('express');
const router = express.Router();
const { generateSetupScript } = require('../templates/setupScript');

// POST /api/cloudshare/script
router.post('/script', (req, res) => {
  try {
    const script = generateSetupScript(req.body);
    res.json({ script });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
