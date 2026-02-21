const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  participants: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }],
  isGroup: {
    type: Boolean,
    default: false
  },
  groupName: {
    type: String,
    default: ''
  },
  groupAvatar: {
    type: String,
    default: ''
  },
  groupAdmin: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  lastMessage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message'
  },
  unreadCount: {
    type: Map,
    of: Number,
    default: new Map()
  },
  typingUsers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  isArchived: {
    type: Map,
    of: Boolean,
    default: new Map()
  },
  isMuted: {
    type: Map,
    of: {
      until: Date,
      isMuted: Boolean
    },
    default: new Map()
  },
  theme: {
    type: String,
    default: 'default' // custom themes like Instagram
  },
  emoji: {
    type: String,
    default: '❤️' // default reaction emoji
  }
}, {
  timestamps: true
});

// Index for faster queries
conversationSchema.index({ participants: 1 });
conversationSchema.index({ updatedAt: -1 });

module.exports = mongoose.model('Conversation', conversationSchema);
