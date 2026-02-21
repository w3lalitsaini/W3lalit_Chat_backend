const express = require('express');
const router = express.Router();
const conversationController = require('../controllers/conversation.controller');
const authMiddleware = require('../middleware/auth.middleware');

router.get('/', authMiddleware, conversationController.getConversations);
router.get('/user/:userId', authMiddleware, conversationController.getOrCreateConversation);
router.post('/group', authMiddleware, conversationController.createGroup);
router.put('/:conversationId', authMiddleware, conversationController.updateConversation);
router.post('/:conversationId/read', authMiddleware, conversationController.markAsRead);
router.delete('/:conversationId', authMiddleware, conversationController.deleteConversation);

module.exports = router;
