const { pool } = require('../config/db');

const UserModel = {
  // Create new user
  async create(userData) {
    const { username, email, password, avatar } = userData;
    const [result] = await pool.execute(
      'INSERT INTO users (username, email, password, avatar) VALUES (?, ?, ?, ?)',
      [username, email, password, avatar || null]
    );
    return result.insertId;
  },

  // Find user by email
  async findByEmail(email) {
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
    return rows[0];
  },

  // Find user by ID
  async findById(id) {
    const [rows] = await pool.execute('SELECT id, username, email, avatar, created_at FROM users WHERE id = ?', [id]);
    return rows[0];
  },

  // Get all users except current user
  async getAllExcept(userId) {
    const [rows] = await pool.execute(
      'SELECT id, username, email, avatar, created_at FROM users WHERE id != ? ORDER BY username',
      [userId]
    );
    return rows;
  },

  // Update user
  async update(id, userData) {
    const { username, avatar } = userData;
    await pool.execute(
      'UPDATE users SET username = ?, avatar = ? WHERE id = ?',
      [username, avatar, id]
    );
    return true;
  },

  // Update password
  async updatePassword(id, newPassword) {
    await pool.execute('UPDATE users SET password = ? WHERE id = ?', [newPassword, id]);
    return true;
  }
};

module.exports = UserModel;