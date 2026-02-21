const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const User = require('../models/User');

// Get all conversations for user
exports.getConversations = async (req, res) => {
  try {
    const userId = req.userId;

    const conversations = await Conversation.find({
      participants: userId
    })
      .populate('participants', 'username avatar fullName isOnline lastSeen')
      .populate({
        path: 'lastMessage',
        populate: {
          path: 'sender',
          select: 'username avatar'
        }
      })
      .sort({ updatedAt: -1 });

    // Format conversations for frontend
    const formattedConversations = conversations.map(conv => {
      const otherParticipant = conv.participants.find(
        p => p._id.toString() !== userId.toString()
      );

      return {
        _id: conv._id,
        participant: otherParticipant,
        isGroup: conv.isGroup,
        groupName: conv.groupName,
        groupAvatar: conv.groupAvatar,
        lastMessage: conv.lastMessage,
        unreadCount: conv.unreadCount.get(userId.toString()) || 0,
        updatedAt: conv.updatedAt,
        theme: conv.theme,
        emoji: conv.emoji
      };
    });

    res.json({ conversations: formattedConversations });
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get or create conversation with user
exports.getOrCreateConversation = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.userId;

    // Check if conversation exists
    let conversation = await Conversation.findOne({
      isGroup: false,
      participants: {
        $all: [currentUserId, userId],
        $size: 2
      }
    }).populate('participants', 'username avatar fullName isOnline lastSeen');

    if (!conversation) {
      // Create new conversation
      conversation = new Conversation({
        participants: [currentUserId, userId],
        isGroup: false
      });
      await conversation.save();

      conversation = await Conversation.findById(conversation._id)
        .populate('participants', 'username avatar fullName isOnline lastSeen');
    }

    const otherParticipant = conversation.participants.find(
      p => p._id.toString() !== currentUserId.toString()
    );

    res.json({
      conversation: {
        _id: conversation._id,
        participant: otherParticipant,
        isGroup: false,
        theme: conversation.theme,
        emoji: conversation.emoji
      }
    });
  } catch (error) {
    console.error('Get or create conversation error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Create group conversation
exports.createGroup = async (req, res) => {
  try {
    const { name, participants, avatar } = req.body;
    const adminId = req.userId;

    if (!name || !participants || participants.length < 2) {
      return res.status(400).json({
        message: 'Group name and at least 2 participants are required'
      });
    }

    const allParticipants = [...new Set([...participants, adminId])];

    const conversation = new Conversation({
      participants: allParticipants,
      isGroup: true,
      groupName: name,
      groupAvatar: avatar || '',
      groupAdmin: [adminId]
    });

    await conversation.save();

    const populatedConv = await Conversation.findById(conversation._id)
      .populate('participants', 'username avatar fullName isOnline lastSeen');

    res.status(201).json({ conversation: populatedConv });
  } catch (error) {
    console.error('Create group error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update conversation settings
exports.updateConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { theme, emoji, isMuted } = req.body;
    const userId = req.userId;

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    if (!conversation.participants.includes(userId)) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (theme) conversation.theme = theme;
    if (emoji) conversation.emoji = emoji;
    if (isMuted !== undefined) {
      conversation.isMuted.set(userId.toString(), {
        isMuted,
        until: isMuted ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null
      });
    }

    await conversation.save();

    res.json({ message: 'Conversation updated', conversation });
  } catch (error) {
    console.error('Update conversation error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Mark conversation as read
exports.markAsRead = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.userId;

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // Reset unread count
    conversation.unreadCount.set(userId.toString(), 0);
    await conversation.save();

    // Mark all messages as seen
    await Message.updateMany(
      {
        conversation: conversationId,
        sender: { $ne: userId },
        'seenBy.user': { $ne: userId }
      },
      {
        $push: {
          seenBy: { user: userId, seenAt: new Date() }
        }
      }
    );

    res.json({ message: 'Marked as read' });
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Delete conversation
exports.deleteConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const userId = req.userId;

    const conversation = await Conversation.findById(conversationId);

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    if (!conversation.participants.includes(userId)) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // For 1-on-1 chats, we can archive for the user
    // For groups, only admins can delete
    if (conversation.isGroup) {
      if (!conversation.groupAdmin.includes(userId)) {
        return res.status(403).json({ message: 'Only admin can delete group' });
      }
      await Conversation.findByIdAndDelete(conversationId);
      await Message.deleteMany({ conversation: conversationId });
    } else {
      conversation.isArchived.set(userId.toString(), true);
      await conversation.save();
    }

    res.json({ message: 'Conversation deleted' });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
