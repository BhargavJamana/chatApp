const express = require('express');
const router = express.Router();
const { getUsers, getUser, searchUsers, getUserByInviteCode } = require('../controllers/userController');
const { protect } = require('../middleware/auth');

router.use(protect);

router.get('/', getUsers);
router.get('/search', searchUsers);
router.get('/invite/:publicId', getUserByInviteCode);
router.get('/:id', getUser);

module.exports = router;
