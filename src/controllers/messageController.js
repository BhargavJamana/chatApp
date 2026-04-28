const Message = require('../models/Message');

// @desc    Get conversation with user
// @route   GET /api/messages/:userId
// @access  Private
exports.getConversation = async (req, res) => {
  try {
    const otherUserId = Number.parseInt(req.params.userId, 10);
    const { limit, offset } = req.query;
    const safeLimit = Number.parseInt(limit, 10);
    const safeOffset = Number.parseInt(offset, 10);

    if (!Number.isInteger(otherUserId) || otherUserId <= 0) {
      return res.status(400).json({ message: 'Invalid user id' });
    }

    const seenMessageIds = await Message.markAsSeen(otherUserId, req.user.id);
    const messages = await Message.getConversation(
      req.user.id,
      otherUserId,
      Number.isInteger(safeLimit) ? safeLimit : 50,
      Number.isInteger(safeOffset) ? safeOffset : 0
    );

    if (seenMessageIds.length) {
      const emitToUser = req.app.get('emitToUser');
      if (emitToUser) {
        emitToUser(otherUserId, 'messagesSeen', {
          byUserId: req.user.id,
          messageIds: seenMessageIds,
          seenAt: new Date().toISOString(),
        });
      }
    }

    res.json({
      success: true,
      count: messages.length,
      messages
    });
  } catch (error) {
    console.error('GetConversation error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get all conversations
// @route   GET /api/messages
// @access  Private
exports.getConversations = async (req, res) => {
  try {
    const messages = await Message.getLastMessages(req.user.id);
    
    res.json({
      success: true,
      count: messages.length,
      conversations: messages
    });
  } catch (error) {
    console.error('GetConversations error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Send message
// @route   POST /api/messages
// @access  Private
exports.sendMessage = async (req, res) => {
  try {
    console.log('POST /messages - body:', Object.keys(req.body), 'file:', req.file ? `${req.file.filename} (${req.file.size}B)` : 'none');
    
    const receiverId = Number.parseInt(req.body.receiver_id, 10);
    let content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
    let messageType = req.body.message_type || 'text';
    const clientMessageId =
      typeof req.body.client_message_id === 'string' ? req.body.client_message_id.trim() : null;

    // Handle file upload (multer)
    if (req.file) {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const fileUrl = `${baseUrl}/uploads/${req.file.filename}`;
      content = fileUrl;
      const mimetype = req.file.mimetype || '';
      if (mimetype.startsWith('image')) messageType = 'image';
      else if (mimetype.startsWith('audio')) messageType = 'voice';
      else messageType = 'file';
      console.log(`File upload: ${messageType} - URL: ${fileUrl}`);
    }

    if (!Number.isInteger(receiverId) || receiverId <= 0) {
      return res.status(400).json({ message: `Invalid receiver_id: ${req.body.receiver_id}` });
    }

    if (!content && !req.file) {
      return res.status(400).json({ message: 'Please provide content or upload a file' });
    }

    const onlineUsers = req.app.get('onlineUsers');
    const emitToUser = req.app.get('emitToUser');
    const receiverSockets = onlineUsers?.get(String(receiverId));
    const receiverOnline = Boolean(receiverSockets && receiverSockets.size > 0);

    const messageId = await Message.create({
      sender_id: req.user.id,
      receiver_id: receiverId,
      content,
      message_type: messageType,
      client_message_id: clientMessageId || null,
    });

    if (receiverOnline) {
      await Message.markDelivered(messageId);
    }

    const message = await Message.getById(messageId);

    if (emitToUser && message) {
      emitToUser(req.user.id, 'messageSent', message);
      emitToUser(receiverId, 'newMessage', message);
    }

    res.status(201).json({
      success: true,
      message
    });
  } catch (error) {
    console.error('SendMessage error:', error.message);
    
    // Handle multer errors
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ message: 'File too large' });
    }
    if (error.message && error.message.includes('File type not allowed')) {
      return res.status(400).json({ message: error.message });
    }
    
    res.status(500).json({ message: 'Server error: ' + error.message });
  }
};

// @desc    Get unread count
// @route   GET /api/messages/unread
// @access  Private
exports.getUnreadCount = async (req, res) => {
  try {
    const count = await Message.getUnreadCount(req.user.id);
    res.json({
      success: true,
      unread: count
    });
  } catch (error) {
    console.error('GetUnreadCount error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};
