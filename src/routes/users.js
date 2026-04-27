const express = require('express');
const router = express.Router();
const { getUsers, getUser, searchUsers } = require('../controllers/userController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', getUsers);
router.get('/search', searchUsers);
router.get('/:id', getUser);

module.exports = router;