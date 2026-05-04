const express = require('express');
const router = express.Router();
const { getPulse } = require('../controllers/pulseController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', getPulse);

module.exports = router;
