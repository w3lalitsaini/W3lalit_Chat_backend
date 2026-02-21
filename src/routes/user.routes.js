const express = require("express");
const router = express.Router();
const userController = require("../controllers/user.controller");
const authMiddleware = require("../middleware/auth.middleware");

router.get("/search", authMiddleware, userController.searchUsers);
router.get("/suggested", authMiddleware, userController.getSuggestedUsers);
router.get("/online-status", authMiddleware, userController.getOnlineStatus);
router.post("/:userId/follow", authMiddleware, userController.toggleFollow);
router.get("/:userId", authMiddleware, userController.getUserById);
router.put("/profile", authMiddleware, userController.updateProfile);

module.exports = router;
