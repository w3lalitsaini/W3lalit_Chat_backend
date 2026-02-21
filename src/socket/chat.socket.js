const User = require("../models/User");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

const onlineUsers = new Map(); // userId -> socketId
const userSockets = new Map(); // socketId -> userId

const setupSocketHandlers = (io) => {
  io.on("connection", (socket) => {
    console.log("New client connected:", socket.id);

    // User joins with their userId
    socket.on("join", async (userId) => {
      try {
        onlineUsers.set(userId, socket.id);
        userSockets.set(socket.id, userId);
        socket.userId = userId;

        // Join user's room for direct messages
        socket.join(userId);

        // Update user's online status
        await User.findByIdAndUpdate(userId, {
          isOnline: true,
          lastSeen: new Date(),
        });

        // Notify friends that user is online
        const user = await User.findById(userId);
        if (user) {
          const friends = [...user.followers, ...user.following];
          friends.forEach((friendId) => {
            const friendSocketId = onlineUsers.get(friendId.toString());
            if (friendSocketId) {
              io.to(friendSocketId).emit("user_online", { userId });
            }
          });
        }

        // Join all conversation rooms
        const conversations = await Conversation.find({
          participants: userId,
        });
        conversations.forEach((conv) => {
          socket.join(conv._id.toString());
        });

        console.log(`User ${userId} joined with socket ${socket.id}`);
      } catch (error) {
        console.error("Join error:", error);
      }
    });

    // Handle typing indicator
    socket.on("typing", async ({ conversationId, isTyping }) => {
      try {
        const userId = socket.userId;
        if (!userId) return;

        const conversation = await Conversation.findById(conversationId);
        if (!conversation) return;

        // Update typing users in conversation
        if (isTyping) {
          if (!conversation.typingUsers.includes(userId)) {
            conversation.typingUsers.push(userId);
            await conversation.save();
          }
        } else {
          conversation.typingUsers = conversation.typingUsers.filter(
            (id) => id.toString() !== userId,
          );
          await conversation.save();
        }

        // Broadcast to other participants
        socket.to(conversationId).emit("typing", {
          conversationId,
          userId,
          isTyping,
        });
      } catch (error) {
        console.error("Typing error:", error);
      }
    });

    // Handle message seen
    socket.on("message_seen", async ({ messageId, conversationId }) => {
      try {
        const userId = socket.userId;
        if (!userId) return;

        const message = await Message.findById(messageId);
        if (!message) return;

        // Check if already seen
        const alreadySeen = message.seenBy.some(
          (s) => s.user.toString() === userId,
        );

        if (!alreadySeen) {
          message.seenBy.push({ user: userId, seenAt: new Date() });
          await message.save();

          // Notify sender
          const senderSocketId = onlineUsers.get(message.sender.toString());
          if (senderSocketId) {
            io.to(senderSocketId).emit("message_seen", {
              messageId,
              seenBy: userId,
              seenAt: new Date(),
            });
          }
        }
      } catch (error) {
        console.error("Message seen error:", error);
      }
    });

    // Handle call signaling (for future video/audio calls)
    socket.on("call_offer", async ({ to, offer, type }) => {
      const toSocketId = onlineUsers.get(to);
      if (toSocketId) {
        io.to(toSocketId).emit("call_offer", {
          from: socket.userId,
          offer,
          type,
        });

        // Log call start
        try {
          const conversation = await Conversation.findOne({
            participants: { $all: [socket.userId, to] },
          });
          if (conversation) {
            const message = new Message({
              conversation: conversation._id,
              sender: socket.userId,
              content: `${type.charAt(0).toUpperCase() + type.slice(1)} call started`,
              messageType: "call",
            });
            await message.save();
            const populatedMessage = await Message.findById(
              message._id,
            ).populate("sender", "username avatar fullName");
            io.to(socket.userId).emit("new_message", populatedMessage);
            io.to(to).emit("new_message", populatedMessage);

            conversation.lastMessage = message._id;
            await conversation.save();
          }
        } catch (err) {
          console.error("Call logging error:", err);
        }
      }
    });

    socket.on("call_answer", ({ to, answer }) => {
      const toSocketId = onlineUsers.get(to);
      if (toSocketId) {
        io.to(toSocketId).emit("call_answer", {
          from: socket.userId,
          answer,
        });
      }
    });

    socket.on("ice_candidate", ({ to, candidate }) => {
      const toSocketId = onlineUsers.get(to);
      if (toSocketId) {
        io.to(toSocketId).emit("ice_candidate", {
          from: socket.userId,
          candidate,
        });
      }
    });

    socket.on("end_call", async ({ to }) => {
      const toSocketId = onlineUsers.get(to);
      if (toSocketId) {
        io.to(toSocketId).emit("end_call", {
          from: socket.userId,
        });

        // Log call end
        try {
          const conversation = await Conversation.findOne({
            participants: { $all: [socket.userId, to] },
          });
          if (conversation) {
            const message = new Message({
              conversation: conversation._id,
              sender: socket.userId,
              content: `Call ended`,
              messageType: "call",
            });
            await message.save();
            const populatedMessage = await Message.findById(
              message._id,
            ).populate("sender", "username avatar fullName");
            io.to(socket.userId).emit("new_message", populatedMessage);
            io.to(to).emit("new_message", populatedMessage);

            conversation.lastMessage = message._id;
            await conversation.save();
          }
        } catch (err) {
          console.error("Call logging error:", err);
        }
      }
    });

    // Handle disconnect
    socket.on("disconnect", async () => {
      try {
        const userId = userSockets.get(socket.id);
        if (userId) {
          onlineUsers.delete(userId);
          userSockets.delete(socket.id);

          // Update user's last seen
          await User.findByIdAndUpdate(userId, {
            isOnline: false,
            lastSeen: new Date(),
          });

          // Notify friends that user is offline
          const user = await User.findById(userId);
          if (user) {
            const friends = [...user.followers, ...user.following];
            friends.forEach((friendId) => {
              const friendSocketId = onlineUsers.get(friendId.toString());
              if (friendSocketId) {
                io.to(friendSocketId).emit("user_offline", {
                  userId,
                  lastSeen: new Date(),
                });
              }
            });
          }

          console.log(`User ${userId} disconnected`);
        }
      } catch (error) {
        console.error("Disconnect error:", error);
      }
    });
  });
};

module.exports = { setupSocketHandlers, onlineUsers };
