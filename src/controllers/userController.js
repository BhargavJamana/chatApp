const User = require('../models/User');
const Message = require('../models/Message');

// @desc    Get all users
// @route   GET /api/users
// @access  Private
exports.getUsers = async (req, res) => {
  try {
    const users = await User.getAllExcept(req.user.id);
    res.json({
      success: true,
      count: users.length,
      users
    });
  } catch (error) {
    console.error('GetUsers error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Get user by ID
// @route   GET /api/users/:id
// @access  Private
exports.getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({
      success: true,
      user
    });
  } catch (error) {
    console.error('GetUser error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

// @desc    Search users
// @route   GET /api/users/search
// @access  Private
exports.searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    const { pool } = require('../config/db');
    
    const [users] = await pool.execute(
      'SELECT id, username, email, avatar FROM users WHERE username LIKE ? AND id != ?',
      [`%${q}%`, req.user.id]
    );
    
    res.json({
      success: true,
      count: users.length,
      users
    });
  } catch (error) {
    console.error('SearchUsers error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};