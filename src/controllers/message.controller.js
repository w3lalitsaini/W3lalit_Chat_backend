const Message = require('../models/Message');
const Conversation = require('../models/Conversation');
const { cloudinary } = require('../utils/cloudinary');

// Get messages for a conversation
exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    const userId = req.userId;

    // Verify user is part of conversation
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.participants.includes(userId)) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const messages = await Message.find({
      conversation: conversationId,
      isDeleted: false
    })
      .populate('sender', 'username avatar fullName')
      .populate({
        path: 'replyTo',
        populate: {
          path: 'sender',
          select: 'username avatar'
        }
      })
      .populate('reactions.user', 'username avatar')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    // Mark messages as delivered
    const undeliveredMessages = messages.filter(
      msg =>
        msg.sender._id.toString() !== userId.toString() &&
        !msg.deliveredTo.some(d => d.user.toString() === userId.toString())
    );

    for (const msg of undeliveredMessages) {
      msg.deliveredTo.push({
        user: userId,
        deliveredAt: new Date()
      });
      await msg.save();
    }

    res.json({
      messages: messages.reverse(),
      hasMore: messages.length === parseInt(limit)
    });
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Send message
exports.sendMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { content, messageType = 'text', replyTo, mediaUrl, duration } = req.body;
    const senderId = req.userId;

    // Verify conversation exists and user is participant
    const conversation = await Conversation.findById(conversationId);
    if (!conversation || !conversation.participants.includes(senderId)) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Create message
    const message = new Message({
      conversation: conversationId,
      sender: senderId,
      content,
      messageType,
      replyTo: replyTo || null,
      mediaUrl: mediaUrl || '',
      duration: duration || 0
    });

    await message.save();

    // Update conversation last message
    conversation.lastMessage = message._id;

    // Update unread counts for other participants
    conversation.participants.forEach(participantId => {
      if (participantId.toString() !== senderId.toString()) {
        const currentCount = conversation.unreadCount.get(participantId.toString()) || 0;
        conversation.unreadCount.set(participantId.toString(), currentCount + 1);
      }
    });

    await conversation.save();

    // Populate and return message
    const populatedMessage = await Message.findById(message._id)
      .populate('sender', 'username avatar fullName')
      .populate({
        path: 'replyTo',
        populate: {
          path: 'sender',
          select: 'username avatar'
        }
      });

    // Emit to socket
    const io = req.app.get('io');
    conversation.participants.forEach(participantId => {
      if (participantId.toString() !== senderId.toString()) {
        io.to(participantId.toString()).emit('new_message', populatedMessage);
      }
    });

    res.status(201).json({ message: populatedMessage });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Delete message
exports.deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const userId = req.userId;

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    if (message.sender.toString() !== userId.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    message.isDeleted = true;
    message.deletedAt = new Date();
    message.content = 'This message was deleted';
    await message.save();

    // Emit deletion to other participants
    const io = req.app.get('io');
    const conversation = await Conversation.findById(message.conversation);
    conversation.participants.forEach(participantId => {
      if (participantId.toString() !== userId.toString()) {
        io.to(participantId.toString()).emit('message_deleted', { messageId });
      }
    });

    res.json({ message: 'Message deleted' });
  } catch (error) {
    console.error('Delete message error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Add reaction to message
exports.addReaction = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.userId;

    const message = await Message.findById(messageId);

    if (!message) {
      return res.status(404).json({ message: 'Message not found' });
    }

    // Check if user already reacted with this emoji
    const existingReactionIndex = message.reactions.findIndex(
      r => r.user.toString() === userId.toString() && r.emoji === emoji
    );

    if (existingReactionIndex > -1) {
      // Remove reaction if same emoji clicked again
      message.reactions.splice(existingReactionIndex, 1);
    } else {
      // Remove any existing reaction from this user
      message.reactions = message.reactions.filter(
        r => r.user.toString() !== userId.toString()
      );
      // Add new reaction
      message.reactions.push({ user: userId, emoji });
    }

    await message.save();

    const populatedMessage = await Message.findById(messageId)
      .populate('sender', 'username avatar fullName')
      .populate('reactions.user', 'username avatar');

    // Emit reaction update
    const io = req.app.get('io');
    const conversation = await Conversation.findById(message.conversation);
    conversation.participants.forEach(participantId => {
      io.to(participantId.toString()).emit('message_reaction', {
        messageId,
        reactions: populatedMessage.reactions
      });
    });

    res.json({ message: populatedMessage });
  } catch (error) {
    console.error('Add reaction error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Upload media to Cloudinary
exports.uploadMedia = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    res.json({
      url: req.file.path,
      publicId: req.file.filename,
      type: req.file.mimetype
    });
  } catch (error) {
    console.error('Upload media error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Forward message
exports.forwardMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { conversationIds } = req.body;
    const userId = req.userId;

    const originalMessage = await Message.findById(messageId);
    if (!originalMessage) {
      return res.status(404).json({ message: 'Message not found' });
    }

    const forwardedMessages = [];

    for (const convId of conversationIds) {
      const conversation = await Conversation.findById(convId);
      if (!conversation || !conversation.participants.includes(userId)) {
        continue;
      }

      const newMessage = new Message({
        conversation: convId,
        sender: userId,
        content: originalMessage.content,
        messageType: originalMessage.messageType,
        mediaUrl: originalMessage.mediaUrl,
        mediaThumbnail: originalMessage.mediaThumbnail,
        fileName: originalMessage.fileName,
        fileSize: originalMessage.fileSize,
        duration: originalMessage.duration,
        forwardedFrom: originalMessage.sender
      });

      await newMessage.save();

      conversation.lastMessage = newMessage._id;
      await conversation.save();

      const populatedMessage = await Message.findById(newMessage._id)
        .populate('sender', 'username avatar fullName')
        .populate('forwardedFrom', 'username avatar fullName');

      forwardedMessages.push(populatedMessage);

      // Emit to socket
      const io = req.app.get('io');
      conversation.participants.forEach(participantId => {
        io.to(participantId.toString()).emit('new_message', populatedMessage);
      });
    }

    res.json({ messages: forwardedMessages });
  } catch (error) {
    console.error('Forward message error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
