import express from "express";
import {
  authenticateAdmin,
  authenticateUser,
} from "../middleware/middleware.js";
import {
  createAffiliateTierController,
  updateAffiliateTierController,
  deleteAffiliateTierController,
  toggleAffiliateTierStatusController,
} from "../controllers/tier/tier.controller.js";
import {
  getAllAffiliateTiersController,
  getAllAffiliateTiersWithIdController,
  getRewardLogByIdController,
  getUserTierProgressController,
  getAllMyRewardsController,
} from "../controllers/tier/tier.retrieve.controller.js";
import {
  claimUserRewardController,
  getUserRewardsForTheirAdmins,
  updateClaimedRewards,
} from "../controllers/tier/tier.rewards.controller.js";

const router = express.Router();

// Create Tier
router.post("/", authenticateAdmin, createAffiliateTierController);

// Update Tier
router.put("/:tierId", authenticateAdmin, updateAffiliateTierController);

// Delete Tier
router.delete(
  "/delete/:tierId",
  authenticateAdmin,
  deleteAffiliateTierController
);

// Toggle Active/Inactive
router.patch(
  "/toggle/:tierId",
  authenticateAdmin,
  toggleAffiliateTierStatusController
);

// ==== GET routes (static paths BEFORE /:tierId) ====

router.get("/all", authenticateAdmin, getAllAffiliateTiersController);

// Alias: GET /api/tier/ → list all (avoids 404 from empty-id callers)
router.get("/", authenticateAdmin, getAllAffiliateTiersController);

router.get("/user/my-tier", authenticateUser, getUserTierProgressController);
router.get(
  "/user/my-rewards/:id",
  authenticateUser,
  getRewardLogByIdController
);
router.get("/user/allMyRewards", authenticateUser, getAllMyRewardsController);
router.put("/user/claim/reward", authenticateUser, claimUserRewardController);

router.get(
  "/admin/user-tier/:userId",
  authenticateAdmin,
  getUserTierProgressController
);
router.get("/admin/rewards", authenticateAdmin, getUserRewardsForTheirAdmins);
router.patch(
  "/admin/reward/update/:rewardLogId",
  authenticateAdmin,
  updateClaimedRewards
);

// Single tier by id (must be last among GETs)
router.get("/:tierId", authenticateAdmin, getAllAffiliateTiersWithIdController);

export default router;
