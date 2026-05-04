require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { pool, testConnection } = require('./config/db');
const { runMigrations } = require('./config/migrations');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const messageRoutes = require('./routes/messages');
const pulseRoutes = require('./routes/pulse');
const Message = require('./models/Message');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  })
);
app.use(express.json());
// static uploads
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, '..', '..', 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/pulse', pulseRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Map<userId, Set<socketId>>
const onlineUsers = new Map();

const parseUserId = (value) => {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const normalizeCallType = (value) => (String(value).toLowerCase() === 'video' ? 'video' : 'audio');

const getUserSocketIds = (userId) => {
  const key = String(userId);
  const set = onlineUsers.get(key);
  if (!set) return [];
  return Array.from(set);
};

const emitToUser = (userId, event, payload) => {
  const socketIds = getUserSocketIds(userId);
  socketIds.forEach((socketId) => {
    io.to(socketId).emit(event, payload);
  });
};

const getOnlineUserIds = () => Array.from(onlineUsers.keys()).map((id) => Number.parseInt(id, 10));

const addSocketForUser = (userId, socketId) => {
  const key = String(userId);
  const existing = onlineUsers.get(key);
  if (existing) {
    existing.add(socketId);
    return false;
  }
  const next = new Set([socketId]);
  onlineUsers.set(key, next);
  return true;
};

const removeSocketForUser = (userId, socketId) => {
  const key = String(userId);
  const existing = onlineUsers.get(key);
  if (!existing) return true;

  existing.delete(socketId);
  if (!existing.size) {
    onlineUsers.delete(key);
    return true;
  }

  onlineUsers.set(key, existing);
  return false;
};

app.set('io', io);
app.set('onlineUsers', onlineUsers);
app.set('emitToUser', emitToUser);

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('authenticate', async (userId) => {
    const parsedUserId = parseUserId(userId);
    if (!parsedUserId) return;

    const wasOffline = addSocketForUser(parsedUserId, socket.id);
    socket.userId = String(parsedUserId);

    socket.emit('onlineUsers', { userIds: getOnlineUserIds() });
    if (wasOffline) {
      io.emit('userOnline', { userId: parsedUserId, onlineAt: new Date().toISOString() });
    }

    try {
      const deliveryUpdates = await Message.markPendingDeliveredForReceiver(parsedUserId);
      if (deliveryUpdates.length) {
        const senderBuckets = deliveryUpdates.reduce((acc, update) => {
          const senderId = String(update.sender_id);
          if (!acc[senderId]) acc[senderId] = [];
          acc[senderId].push(update.id);
          return acc;
        }, {});

        const deliveredAt = new Date().toISOString();
        Object.entries(senderBuckets).forEach(([senderId, messageIds]) => {
          emitToUser(senderId, 'messagesDelivered', {
            toUserId: parsedUserId,
            messageIds,
            deliveredAt,
          });
        });
      }
    } catch (error) {
      console.error('Failed to sync pending delivered messages:', error.message);
    }
  });

  // Kept for backward compatibility with old clients.
  socket.on('sendMessage', async (data) => {
    try {
      const senderId = parseUserId(socket.userId || data.senderId);
      const receiverId = parseUserId(data.receiverId);
      const content = typeof data.content === 'string' ? data.content.trim() : '';
      const messageType = data.messageType || 'text';
      const clientMessageId = typeof data.clientMessageId === 'string' ? data.clientMessageId.trim() : null;

      if (!senderId || !receiverId || !content) {
        socket.emit('messageError', { message: 'Invalid message payload' });
        return;
      }

      const messageId = await Message.create({
        sender_id: senderId,
        receiver_id: receiverId,
        content,
        message_type: messageType,
        client_message_id: clientMessageId || null,
      });

      if (getUserSocketIds(receiverId).length > 0) {
        await Message.markDelivered(messageId);
      }

      const messageData = await Message.getById(messageId);
      if (!messageData) {
        socket.emit('messageError', { message: 'Failed to save message' });
        return;
      }

      emitToUser(receiverId, 'newMessage', messageData);
      emitToUser(senderId, 'messageSent', messageData);
    } catch (error) {
      console.error('Socket sendMessage error:', error.message);
      socket.emit('messageError', { message: 'Failed to send message' });
    }
  });

  socket.on('typing', (data) => {
    const receiverId = parseUserId(data.receiverId);
    const senderId = parseUserId(data.senderId);
    if (!receiverId || !senderId) return;
    emitToUser(receiverId, 'userTyping', { senderId });
  });

  socket.on('stopTyping', (data) => {
    const receiverId = parseUserId(data.receiverId);
    const senderId = parseUserId(data.senderId);
    if (!receiverId || !senderId) return;
    emitToUser(receiverId, 'userStopTyping', { senderId });
  });

  socket.on('markRead', (data) => {
    const senderId = parseUserId(data.senderId);
    const receiverId = parseUserId(data.receiverId);
    if (!senderId || !receiverId) return;
    emitToUser(senderId, 'messagesRead', { receiverId });
  });

  socket.on('call:offer', (data = {}) => {
    const fromUserId = parseUserId(socket.userId || data.fromUserId);
    const toUserId = parseUserId(data.toUserId);
    const offer = data.offer;
    if (!fromUserId || !toUserId || !offer || fromUserId === toUserId) return;

    if (!getUserSocketIds(toUserId).length) {
      emitToUser(fromUserId, 'call:unavailable', {
        toUserId,
        reason: 'offline',
        at: new Date().toISOString(),
      });
      return;
    }

    emitToUser(toUserId, 'call:incoming', {
      fromUserId,
      fromUsername: typeof data.fromUsername === 'string' ? data.fromUsername.slice(0, 64) : 'User',
      fromAvatar: typeof data.fromAvatar === 'string' ? data.fromAvatar : null,
      callType: normalizeCallType(data.callType),
      offer,
      at: new Date().toISOString(),
    });
  });

  socket.on('call:answer', (data = {}) => {
    const fromUserId = parseUserId(socket.userId || data.fromUserId);
    const toUserId = parseUserId(data.toUserId);
    if (!fromUserId || !toUserId || !data.answer) return;

    emitToUser(toUserId, 'call:answered', {
      fromUserId,
      answer: data.answer,
      callType: normalizeCallType(data.callType),
      at: new Date().toISOString(),
    });
  });

  socket.on('call:ice-candidate', (data = {}) => {
    const fromUserId = parseUserId(socket.userId || data.fromUserId);
    const toUserId = parseUserId(data.toUserId);
    if (!fromUserId || !toUserId || !data.candidate) return;

    emitToUser(toUserId, 'call:ice-candidate', {
      fromUserId,
      candidate: data.candidate,
      at: new Date().toISOString(),
    });
  });

  socket.on('call:reject', (data = {}) => {
    const fromUserId = parseUserId(socket.userId || data.fromUserId);
    const toUserId = parseUserId(data.toUserId);
    if (!fromUserId || !toUserId) return;

    emitToUser(toUserId, 'call:rejected', {
      fromUserId,
      reason: typeof data.reason === 'string' ? data.reason : 'declined',
      at: new Date().toISOString(),
    });
  });

  socket.on('call:end', (data = {}) => {
    const fromUserId = parseUserId(socket.userId || data.fromUserId);
    const toUserId = parseUserId(data.toUserId);
    if (!fromUserId || !toUserId) return;

    emitToUser(toUserId, 'call:ended', {
      fromUserId,
      at: new Date().toISOString(),
    });

    // persist call log if DB available
    (async () => {
      try {
        const startedAt = data.startedAt || data.started_at ? new Date(data.startedAt || data.started_at) : null;
        const endedAt = data.endedAt || data.ended_at ? new Date(data.endedAt || data.ended_at) : new Date();
        const duration = data.duration_seconds || data.duration || (startedAt ? Math.floor((endedAt - startedAt) / 1000) : null);
        const callType = normalizeCallType(data.callType || data.call_type || 'audio');
        await pool.execute(
          'INSERT INTO call_logs (caller_id, callee_id, call_type, status, started_at, ended_at, duration_seconds) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [fromUserId, toUserId, callType, data.status || 'completed', startedAt ? startedAt.toISOString().slice(0, 19).replace('T', ' ') : new Date().toISOString().slice(0, 19).replace('T', ' '), endedAt ? endedAt.toISOString().slice(0, 19).replace('T', ' ') : null, duration]
        );
      } catch (err) {
        console.warn('Failed to persist call log', err?.message || err);
      }
    })();
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      const parsedUserId = parseUserId(socket.userId);
      if (parsedUserId) {
        const isNowOffline = removeSocketForUser(parsedUserId, socket.id);
        if (isNowOffline) {
          io.emit('userOffline', {
            userId: parsedUserId,
            lastSeenAt: new Date().toISOString(),
          });
        }
      }
    }
    console.log('Socket disconnected:', socket.id);
  });
});

app.get('/api/online-users', (req, res) => {
  res.json({ onlineUsers: getOnlineUserIds() });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  const dbConnected = await testConnection();

  if (!dbConnected) {
    console.warn('Database connection failed. Running in limited mode.');
  } else {
    try {
      await runMigrations(pool);
      console.log('Database migrations complete');
    } catch (error) {
      console.error('Migration failed:', error.message);
    }
  }

  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
};

startServer();

module.exports = { app, io };
