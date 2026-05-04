const { pool } = require('../config/db');

const toPositiveInt = (value, fallback = null) => {
  if (value === null || value === undefined) return fallback;
  // Handle string or number
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const toNonNegativeInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const normalizeMessageType = (type) => {
  const value = String(type || 'text').toLowerCase();
  const allowed = new Set(['text', 'image', 'file', 'system', 'voice', 'audio']);
  return allowed.has(value) ? value : 'text';
};

const normalizeClientMessageId = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.slice(0, 64);
};

const MessageModel = {
  async create(messageData) {
    const senderId = toPositiveInt(messageData.sender_id);
    const receiverId = toPositiveInt(messageData.receiver_id);
    const content = typeof messageData.content === 'string' ? messageData.content.trim() : '';
    const messageType = normalizeMessageType(messageData.message_type);
    const clientMessageId = normalizeClientMessageId(messageData.client_message_id);

    if (!senderId || !receiverId || !content) {
      throw new Error('Invalid message payload');
    }

    if (clientMessageId) {
      const existing = await this.getByClientMessageId(clientMessageId);
      if (existing) {
        return existing.id;
      }
    }

    try {
      const [result] = await pool.execute(
        `INSERT INTO messages
          (sender_id, receiver_id, content, message_type, client_message_id, delivery_status)
         VALUES (?, ?, ?, ?, ?, 'sent')`,
        [senderId, receiverId, content, messageType, clientMessageId]
      );
      return result.insertId;
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY' && clientMessageId) {
        const existing = await this.getByClientMessageId(clientMessageId);
        if (existing) {
          return existing.id;
        }
      }
      throw error;
    }
  },

  async getByClientMessageId(clientMessageId) {
    const normalized = normalizeClientMessageId(clientMessageId);
    if (!normalized) return null;

    const [rows] = await pool.execute('SELECT id FROM messages WHERE client_message_id = ? LIMIT 1', [
      normalized,
    ]);
    return rows[0] || null;
  },

  async getById(messageId) {
    const safeMessageId = toPositiveInt(messageId);
    if (!safeMessageId) return null;

    const [rows] = await pool.execute(
      `SELECT m.*, 
              sender.username as sender_username,
              sender.avatar as sender_avatar,
              receiver.username as receiver_username,
              receiver.avatar as receiver_avatar
       FROM messages m
       JOIN users sender ON m.sender_id = sender.id
       JOIN users receiver ON m.receiver_id = receiver.id
       WHERE m.id = ?`,
      [safeMessageId]
    );

    return rows[0] || null;
  },

  async getConversation(userId, otherUserId, limit = 50, offset = 0) {
    const safeUserId = toPositiveInt(userId);
    const safeOtherUserId = toPositiveInt(otherUserId);
    if (!safeUserId || !safeOtherUserId) return [];

    const safeLimit = Math.min(toPositiveInt(limit, 50), 200);
    const safeOffset = toNonNegativeInt(offset, 0);

    const [rows] = await pool.execute(
      `SELECT m.*, 
              sender.username as sender_username,
              sender.avatar as sender_avatar,
              receiver.username as receiver_username,
              receiver.avatar as receiver_avatar
       FROM messages m
       JOIN users sender ON m.sender_id = sender.id
       JOIN users receiver ON m.receiver_id = receiver.id
       WHERE (m.sender_id = ? AND m.receiver_id = ?) 
          OR (m.sender_id = ? AND m.receiver_id = ?)
       ORDER BY m.created_at DESC
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
      [safeUserId, safeOtherUserId, safeOtherUserId, safeUserId]
    );

    return rows.reverse();
  },

  async getLastMessages(userId) {
    const safeUserId = toPositiveInt(userId);
    if (!safeUserId) return [];

    const [rows] = await pool.execute(
      `SELECT m.*, 
              CASE WHEN m.sender_id = ? THEN m.receiver_id ELSE m.sender_id END as other_user_id,
              CASE WHEN m.sender_id = ? THEN receiver.username ELSE sender.username END as other_username,
              CASE WHEN m.sender_id = ? THEN receiver.avatar ELSE sender.avatar END as other_avatar
       FROM messages m
       JOIN users sender ON m.sender_id = sender.id
       JOIN users receiver ON m.receiver_id = receiver.id
       WHERE m.id IN (
         SELECT MAX(id) FROM messages
         WHERE sender_id = ? OR receiver_id = ?
         GROUP BY LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id)
       )
       ORDER BY m.created_at DESC`,
      [safeUserId, safeUserId, safeUserId, safeUserId, safeUserId]
    );
    return rows;
  },

  async markDelivered(messageId) {
    const safeMessageId = toPositiveInt(messageId);
    if (!safeMessageId) return false;

    const [result] = await pool.execute(
      `UPDATE messages
       SET delivery_status = 'delivered',
           delivered_at = COALESCE(delivered_at, UTC_TIMESTAMP())
       WHERE id = ? AND delivery_status = 'sent'`,
      [safeMessageId]
    );

    return result.affectedRows > 0;
  },

  async markPendingDeliveredForReceiver(receiverId) {
    const safeReceiverId = toPositiveInt(receiverId);
    if (!safeReceiverId) return [];

    const [pendingRows] = await pool.execute(
      `SELECT id, sender_id
       FROM messages
       WHERE receiver_id = ? AND delivery_status = 'sent'`,
      [safeReceiverId]
    );

    if (!pendingRows.length) {
      return [];
    }

    const ids = pendingRows.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(',');

    await pool.execute(
      `UPDATE messages
       SET delivery_status = 'delivered',
           delivered_at = COALESCE(delivered_at, UTC_TIMESTAMP())
       WHERE id IN (${placeholders})`,
      ids
    );

    return pendingRows;
  },

  async markAsSeen(senderId, receiverId) {
    const safeSenderId = toPositiveInt(senderId);
    const safeReceiverId = toPositiveInt(receiverId);
    if (!safeSenderId || !safeReceiverId) return [];

    const [rows] = await pool.execute(
      `SELECT id
       FROM messages
       WHERE sender_id = ? AND receiver_id = ? AND delivery_status != 'seen'`,
      [safeSenderId, safeReceiverId]
    );

    if (!rows.length) {
      return [];
    }

    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(',');

    await pool.execute(
      `UPDATE messages
       SET is_read = 1,
           delivery_status = 'seen',
           delivered_at = COALESCE(delivered_at, UTC_TIMESTAMP()),
           seen_at = COALESCE(seen_at, UTC_TIMESTAMP())
       WHERE id IN (${placeholders})`,
      ids
    );

    return ids;
  },

  async markAsRead(senderId, receiverId) {
    const seenIds = await this.markAsSeen(senderId, receiverId);
    return seenIds.length > 0;
  },

  async getUnreadCount(userId) {
    const safeUserId = toPositiveInt(userId);
    if (!safeUserId) return 0;

    const [rows] = await pool.execute(
      "SELECT COUNT(*) as count FROM messages WHERE receiver_id = ? AND delivery_status != 'seen'",
      [safeUserId]
    );
    return rows[0].count;
  },
};

module.exports = MessageModel;
