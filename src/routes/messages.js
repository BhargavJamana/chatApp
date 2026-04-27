const express = require('express');
const router = express.Router();
const { getConversation, getConversations, sendMessage, getUnreadCount } = require('../controllers/messageController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', getConversations);
router.get('/unread', getUnreadCount);
router.get('/:userId', getConversation);
router.post('/', sendMessage);

module.exports = router;