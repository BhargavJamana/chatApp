const express = require('express');
const router = express.Router();
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const { getConversation, getConversations, sendMessage, getUnreadCount } = require('../controllers/messageController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', getConversations);
router.get('/unread', getUnreadCount);
router.get('/:userId', getConversation);
router.post('/', upload.single('file'), sendMessage);

module.exports = router;