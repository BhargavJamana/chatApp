const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('Created uploads directory:', uploadsDir);
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    // Preserve file extension
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    // Allow common image/audio uploads plus browser-recorded webm/ogg containers
    const allowed = /^(image|audio)\//;
    const allowedMimeTypes = new Set([
      'application/octet-stream',
      'video/webm',
      'audio/webm',
      'audio/ogg',
      'video/ogg',
      'audio/mp4',
      'audio/x-m4a',
      'audio/mpeg',
      'audio/wav',
      'audio/x-wav',
    ]);
    if (allowed.test(file.mimetype) || allowedMimeTypes.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

const { getConversation, getConversations, sendMessage, getUnreadCount } = require('../controllers/messageController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', getConversations);
router.get('/unread', getUnreadCount);
router.get('/:userId', getConversation);
router.post('/', upload.single('file'), sendMessage);

module.exports = router;
