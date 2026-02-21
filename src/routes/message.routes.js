const express = require('express');
const router = express.Router();
const messageController = require('../controllers/message.controller');
const authMiddleware = require('../middleware/auth.middleware');
const { uploadImage, uploadVideo, uploadAudio } = require('../utils/cloudinary');

router.get('/:conversationId', authMiddleware, messageController.getMessages);
router.post('/:conversationId', authMiddleware, messageController.sendMessage);
router.delete('/:messageId', authMiddleware, messageController.deleteMessage);
router.post('/:messageId/reaction', authMiddleware, messageController.addReaction);
router.post('/:messageId/forward', authMiddleware, messageController.forwardMessage);

// Upload endpoints
router.post('/upload/image', authMiddleware, uploadImage.single('file'), messageController.uploadMedia);
router.post('/upload/video', authMiddleware, uploadVideo.single('file'), messageController.uploadMedia);
router.post('/upload/audio', authMiddleware, uploadAudio.single('file'), messageController.uploadMedia);

module.exports = router;
