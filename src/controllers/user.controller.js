const User = require("../models/User");
const Conversation = require("../models/Conversation");

// Search users
exports.searchUsers = async (req, res) => {
  try {
    const { query } = req.query;
    const userId = req.userId;

    if (!query) {
      return res.status(400).json({ message: "Search query is required" });
    }

    const users = await User.find({
      $or: [
        { username: { $regex: query, $options: "i" } },
        { fullName: { $regex: query, $options: "i" } },
      ],
    })
      .select("-password -email -notifications")
      .limit(20);

    res.json({ users });
  } catch (error) {
    console.error("Search users error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get user by ID
exports.getUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId)
      .select("-password -email -notifications -blockedUsers")
      .populate("followers", "username avatar fullName")
      .populate("following", "username avatar fullName");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ user });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get suggested users (people to follow/chat with)
exports.getSuggestedUsers = async (req, res) => {
  try {
    const userId = req.userId;
    const currentUser = await User.findById(userId);

    // Suggestions disabled for privacy
    res.json({ users: [] });
  } catch (error) {
    console.error("Get suggested users error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Follow/Unfollow user
exports.toggleFollow = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.userId;

    if (userId === currentUserId.toString()) {
      return res.status(400).json({ message: "Cannot follow yourself" });
    }

    const userToFollow = await User.findById(userId);
    const currentUser = await User.findById(currentUserId);

    if (!userToFollow) {
      return res.status(404).json({ message: "User not found" });
    }

    const isFollowing = currentUser.following.includes(userId);

    if (isFollowing) {
      // Unfollow
      currentUser.following = currentUser.following.filter(
        (id) => id.toString() !== userId,
      );
      userToFollow.followers = userToFollow.followers.filter(
        (id) => id.toString() !== currentUserId.toString(),
      );
    } else {
      // Follow
      currentUser.following.push(userId);
      userToFollow.followers.push(currentUserId);
    }

    await currentUser.save();
    await userToFollow.save();

    res.json({
      message: isFollowing
        ? "Unfollowed successfully"
        : "Followed successfully",
      isFollowing: !isFollowing,
    });
  } catch (error) {
    console.error("Toggle follow error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// Get online status of users
exports.getOnlineStatus = async (req, res) => {
  try {
    const { userIds } = req.body;

    const users = await User.find({
      _id: { $in: userIds },
    }).select("isOnline lastSeen");

    const statusMap = {};
    users.forEach((user) => {
      statusMap[user._id] = {
        isOnline: user.isOnline,
        lastSeen: user.lastSeen,
      };
    });

    res.json({ status: statusMap });
  } catch (error) {
    console.error("Get online status error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
// Update profile
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.userId;
    const { fullName, bio, avatar } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (fullName !== undefined) user.fullName = fullName;
    if (bio !== undefined) user.bio = bio;
    if (avatar !== undefined) user.avatar = avatar;

    await user.save();

    res.json({
      message: "Profile updated successfully",
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        fullName: user.fullName,
        bio: user.bio,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};
