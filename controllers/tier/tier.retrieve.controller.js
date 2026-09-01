import mongoose from "mongoose";
import { clean } from "../../helper/json-cleaner.js";
import AffUser from "../../models/aff-user.js";
import { Platform } from "../../models/platformSchema.js";
import { TierRewardLog } from "../../models/tier-models/tierRewardLogsSchema.js";
import { Tier } from "../../models/tier-models/tierSystemSchema.js";
import { UserTierProgress } from "../../models/tier-models/tierUserProgressSchema.js";
import { BuildRedeemableRewards } from "../../services/tier/buildRewards.js";
import {
  getFirstActiveLevel,
  getNextTier,
  getStartingTier,
} from "../../services/tier/tierQueries.js";
import { encryptData } from "../../utils/cript-data.js";
import { NotFoundError } from "../../utils/errors.js";

// ================================================================ ///
// ================ GET ALL AFFILIATE TIER ========================= ///
// ================================================================ ///

export const getAllAffiliateTiersController = async (req, res, next) => {
  try {
    const admin = req.admin;

    // Fetch all tiers for the admin, sorted by 'order'
    const tiers = await Tier.find({ adminId: admin._id }).sort({ order: 1 });

    const encryptedTier = encryptData(tiers);

    return res.status(200).json({
      success: true,
      message: "Affiliate tiers fetched successfully",
      data: encryptedTier,
    });
  } catch (error) {
    next(error);
  }
};

export const getAllAffiliateTiersWithIdController = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { tierId } = req.params;

    let tiers;

    // ==========================
    // GET SINGLE TIER BY ID
    // ==========================
    if (tierId) {
      const tier = await Tier.findOne({
        _id: tierId,
        adminId: admin._id,
      });

      if (!tier) {
        return res.status(404).json({
          success: false,
          message: "Tier not found",
          data: [],
        });
      }

      tiers = [tier]; // always return array to match frontend structure
    }

    // ==========================
    // GET ALL TIERS
    // ==========================
    else {
      tiers = await Tier.find({ adminId: admin._id }).sort({ order: 1 });
    }

    const encryptedTier = encryptData(tiers);

    return res.status(200).json({
      success: true,
      message: "Affiliate tiers fetched successfully",
      data: encryptedTier,
    });
  } catch (error) {
    next(error);
  }
};

// ================================================================ ///
// ================ GET USER AFFILIATE CURRENT TIER ========================= ///
// ================================================================ ///

export const getUserAffiliateCurrentTierController = async (req, res, next) => {
  try {
    const admin = req.admin;
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Fetch the user's current tier progress
    const userTierProgress = await UserTierProgress.findOne({
      userId,
      adminId: admin._id,
    }).populate("currentTierId");

    if (!userTierProgress) {
      return res.status(404).json({ message: "User tier progress not found" });
    }

    return res.status(200).json({
      success: true,
      message: "User's current affiliate tier fetched successfully",
      data: userTierProgress.currentTierId,
    });
  } catch (error) {
    next(error);
  }
};

// ================================================================ ///
// ================ GET USER AFFILIATE REWARDS WITH ID ====== ///
// ================================================================ ///

/**
 * @route   GET /api/tier/reward/:id
 * @desc    Get a single tier reward log by ID
 * @access  Private (User must be authenticated)
 */
export const getRewardLogByIdController = async (req, res, next) => {
  try {
    const { id } = req.params;
    const loggedUser = req.user;

    // 1️⃣ Validate ID format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid reward log ID",
      });
    }

    // 2️⃣ Fetch reward log
    const rewardLog = await TierRewardLog.findById(id).lean();

    if (rewardLog.adminId.toString() !== loggedUser.workingOn.toString()) {
      throw new Error("Unauthorized access to reward log");
    }

    // ⭐ OPTIONAL SECURITY CHECK (recommended)
    // Only return if this reward truly belongs to logged-in user
    if (rewardLog.userId.toString() !== loggedUser._id.toString()) {
      return res.status(403).json({
        success: false,
        message: "Unauthorized access to reward log",
      });
    }

    if (!rewardLog) {
      // return res.status(404).json({
      //   success: false,
      //   message: "Reward log not found",
      // });
      throw new Error("Reward log not found");
    }

    const encryptedData = encryptData(rewardLog);

    return res.status(200).json({
      success: true,
      data: encryptedData,
    });
  } catch (err) {
    // console.error("Error fetching reward log by ID:", err);
    next(err);
  }
};

export const getAllMyRewardsController = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const adminId = req.user.workingOn;

    // Fetch all reward logs for the user under the current admin
    const rewardLogs = await TierRewardLog.find({
      userId,
      adminId,
    }).sort({ createdAt: -1 });

    if (!rewardLogs || rewardLogs.length === 0) {
      throw new NotFoundError("No reward logs found for user");
    }

    const pendingRewards = rewardLogs.filter(
      (r) => !r.isClaimed && r.action === "REWARD_EARNED"
    );

    // -----------------------------
    // ⭐ COLLECTED REWARDS (Flattened)
    // -----------------------------
    const collectedRewards = rewardLogs
      // .filter((log) => log.isClaimed === true)
      .flatMap((log) => log.collectedRewards ?? []);

    const safePayload = clean({
      pendingRewards: pendingRewards || [],
      collectedRewards: collectedRewards,
    });

    const encryptedData = encryptData(safePayload);

    return res.status(200).json({
      success: true,
      data: encryptedData,
    });
  } catch (err) {
    console.error("Error fetching all user rewards:", err);
    next(err);
  }
};

// ================================================================ ///
// ================ GET USER AFFILIATE CURRENT TIER PROGRESS ====== ///
// ================================================================ ///
export const getUserTierProgressController = async (req, res, next) => {
  try {
    const userId = req.user ? req.user._id : req.params.userId;

    // 1️⃣ Validate user
    const user = await AffUser.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const adminId = user.workingOn;

    // 2️⃣ Get Admin & Platform
    const admin = await AffUser.findById(adminId);
    if (!admin) throw new NotFoundError("Admin not found");

    const platformId = admin.platformId;

    // ⭐ Always get ALL Rewards first (for fallback response)
    const rawPendingRewards = await TierRewardLog.find({
      userId,
      adminId,
      platformId,
      isClaimed: false,
      action: "REWARD_EARNED",
    }).lean();

    const rawPastRewards = await TierRewardLog.find({
      userId,
      adminId,
      platformId,
      isClaimed: true,
    })
      .sort({ createdAt: -1 })
      .lean();

    const rawAllRewards = [...rawPendingRewards, ...rawPastRewards];

    // Helper → Send ONLY rewards but keep same response shape
    const EMPTY_TIER = {
      levels: [],
      tierName: "",
      order: 0,
    };

    const sendEmptyTierProgress = () => {
      const redeemableRewards = BuildRedeemableRewards(
        rawAllRewards,
        EMPTY_TIER
      );

      const safePayload = clean({
        currentStatus: {},
        nextStep: {},
        levels: [],
        goals: [],
        history: [],
        redeemableRewards,
        allRewards: rawAllRewards,
      });

      return res.status(200).json({
        success: true,
        data: encryptData(safePayload),
      });
    };

    // ============================================================
    // 🚀 Ensure progress doc exists
    // ============================================================
    let progress = await UserTierProgress.findOne({
      userId,
      adminId,
      platformId,
    });

    if (!progress) {
      const firstTier = await getStartingTier(adminId, platformId);

      // ❗ Tier missing → return empty tier progress + rewards
      if (!firstTier) return sendEmptyTierProgress();

      const firstLevel = getFirstActiveLevel(firstTier);

      // ❗ Level missing → return empty tier progress + rewards
      if (!firstLevel) return sendEmptyTierProgress();

      const goalProgress = firstLevel.goals.map((g) => ({
        goalId: g._id.toString(),
        goalType: g.goalType,
        target: g.target,
        progress: 0,
        isCompleted: false,
      }));

      progress = await UserTierProgress.create({
        userId,
        adminId,
        platformId,
        currentTierId: firstTier._id,
        currentLevel: firstLevel.levelNumber,
        isTierCompleted: false,
        goalProgress,
      });
    }

    // 4️⃣ Fetch Current Tier
    const tier = await Tier.findById(progress.currentTierId);

    // ❗ If tier deleted after creation → return empty progress
    // ❗ If tier deleted after creation → check if new tier exists and rebuild progress
    if (!tier) {
      const newFirstTier = await Tier.findOne({
        adminId,
        platformId,
        isActive: true,
      }).sort({ order: 1 });

      if (newFirstTier) {
        const firstLevel =
          newFirstTier.levels.find((l) => l.isActive && l.levelNumber === 1) ||
          newFirstTier.levels.find((l) => l.isActive);

        if (firstLevel) {
          progress.currentTierId = newFirstTier._id;
          progress.currentLevel = firstLevel.levelNumber;
          progress.goalProgress = firstLevel.goals.map((g) => ({
            goalId: g._id.toString(),
            goalType: g.goalType,
            target: g.target,
            progress: 0,
            isCompleted: false,
          }));

          await progress.save();
        }
      } else {
        return sendEmptyTierProgress();
      }
    }

    const currentLevel = tier.levels.find(
      (l) => l.levelNumber === progress.currentLevel
    );

    // ❗ Level removed later → return empty progress
    if (!currentLevel) return sendEmptyTierProgress();

    // ⭐ EVERYTHING BELOW THIS POINT IS UNCHANGED (your full logic restored)

    if (
      !progress.goalProgress ||
      progress.goalProgress.length !== currentLevel.goals.length ||
      !progress.goalProgress.every((pg) =>
        currentLevel.goals.some((g) => g._id.toString() === pg.goalId)
      )
    ) {
      progress.goalProgress = currentLevel.goals.map((g) => ({
        goalId: g._id.toString(),
        goalType: g.goalType,
        target: g.target,
        progress: 0,
        isCompleted: false,
      }));

      await progress.save();
    }

    const goals = currentLevel.goals;

    const goalData = goals.map((g) => {
      const gp = progress.goalProgress.find(
        (p) => p.goalId === g._id.toString()
      );

      return {
        goalId: g._id.toString(),
        goalType: g.goalType,
        target: g.target,
        progress: gp ? gp.progress : 0,
        isCompleted: gp ? gp.isCompleted : false,
      };
    });

    // LEVEL PROGRESS
    let totalPercent = 0;
    goals.forEach((g) => {
      const gp = progress.goalProgress.find(
        (p) => p.goalId === g._id.toString()
      );
      const current = gp ? gp.progress : 0;
      totalPercent += g.target > 0 ? Math.min(current / g.target, 1) : 1;
    });

    const progressPercent = Math.round(
      (totalPercent / (goals.length || 1)) * 100
    );

    // NEXT STEP LOGIC (kept exactly same)
    const nextLevel = tier.levels.find(
      (lvl) => lvl.levelNumber === currentLevel.levelNumber + 1
    );

    let nextStep = { type: "", value: "" };

    const isLastLevel = !nextLevel;
    const isLastTier = !(await getNextTier(adminId, platformId, tier.order));

    const allGoalsCompleted = goalData.every((g) => g.isCompleted);

    if (!isLastLevel) {
      nextStep = { type: "NEXT_LEVEL", value: nextLevel.levelNumber };
    } else if (!isLastTier) {
      const nextTier = await getNextTier(adminId, platformId, tier.order);

      nextStep = { type: "NEXT_TIER", value: nextTier?.tierName ?? "" };
    } else {
      if (allGoalsCompleted) {
        nextStep = { type: "COMPLETED_ALL", value: null };
      } else {
        nextStep = {
          type: "STAY_ON_LAST_LEVEL",
          value: currentLevel.levelNumber,
        };
      }
    }

    // UPCOMING (kept same)
    let upcomingRewards = { scratch: [], spin: [] };

    // 1️⃣ If next level exists → show next level rewards
    if (nextLevel) {
      upcomingRewards = {
        scratch:
          currentLevel.rewardMethod === "SCRATCHCARD"
            ? currentLevel.rewards
            : [],
        spin: currentLevel.rewardMethod === "SPIN" ? currentLevel.rewards : [],
        slider: currentLevel.rewards,
      };
    }

    // 2️⃣ If NO next level (you are on last level) → show CURRENT level rewards
    else {
      upcomingRewards = {
        scratch:
          currentLevel.rewardMethod === "SCRATCHCARD"
            ? currentLevel.rewards
            : [],
        spin: currentLevel.rewardMethod === "SPIN" ? currentLevel.rewards : [],
        slider: currentLevel.rewards,
      };
    }

    const pendingRewards = {
      scratch: rawPendingRewards.filter(
        (r) => r.rewardMethod === "SCRATCHCARD"
      ),
      spin: rawPendingRewards.filter((r) => r.rewardMethod === "SPIN"),
    };

    const pastRewards = {
      scratch: rawPastRewards.filter((r) => r.rewardMethod === "SCRATCHCARD"),
      spin: rawPastRewards.filter((r) => r.rewardMethod === "SPIN"),
    };

    // FINAL rewards
    const redeemableRewards = BuildRedeemableRewards(rawAllRewards, tier);

    // FINAL PAYLOAD
    const safePayload = clean({
      currentStatus: {
        tierName: tier.tierName,
        level: currentLevel.levelNumber,
        currentTierLevel: tier.order,
        progressPercent,
      },

      nextStep,
      levels: tier.levels,
      goals: goalData,

      history: progress.progressHistory,
      redeemableRewards,
      allRewards: rawAllRewards,
      upcomingRewards,

      debug: {
        currentTierId: progress.currentTierId,
        currentLevel: progress.currentLevel,
        goalProgress: progress.goalProgress,
      },
    });

    return res.status(200).json({
      success: true,
      data: encryptData(safePayload),
    });
  } catch (err) {
    console.error("Error fetching tier progress:", err);
    next(err);
  }
};

// export const getUserTierProgressController = async (req, res, next) => {
//   try {
//     const userId = req.user._id;

//     // 1️⃣ Validate user
//     const user = await AffUser.findById(userId);
//     if (!user) return res.status(404).json({ message: "User not found" });

//     const adminId = user.workingOn;

//     // 2️⃣ Get Admin & Platform
//     const admin = await AffUser.findById(adminId);
//     if (!admin) throw new Error("Admin not found");

//     const platformId = admin.platformId;

//     // ============================================================
//     // 🚀 Ensure progress doc exists
//     // ============================================================
//     let progress = await UserTierProgress.findOne({
//       userId,
//       adminId,
//       platformId,
//     });

//     if (!progress) {
//       // Find first tier for admin/platform
//       const firstTier = await Tier.findOne({
//         adminId,
//         platformId,
//         isActive: true,
//       }).sort({ order: 1 });

//       if (!firstTier) {
//         return res.status(404).json({
//           success: false,
//           message: "No active tiers found for admin",
//         });
//       }

//       // First active level
//       const firstLevel =
//         firstTier.levels.find((l) => l.isActive && l.levelNumber === 1) ||
//         firstTier.levels.find((l) => l.isActive);

//       if (!firstLevel) {
//         return res.status(404).json({
//           success: false,
//           message: "Tier has no active levels",
//         });
//       }

//       // Build goalProgress
//       const goalProgress = firstLevel.goals.map((g) => ({
//         goalId: g._id.toString(),
//         goalType: g.goalType,
//         target: g.target,
//         progress: 0,
//         isCompleted: false,
//       }));

//       // Create new progress record
//       progress = await UserTierProgress.create({
//         userId,
//         adminId,
//         platformId,
//         currentTierId: firstTier._id,
//         currentLevel: firstLevel.levelNumber,
//         isTierCompleted: false,
//         goalProgress,
//       });
//     }

//     // 4️⃣ Fetch Current Tier
//     const tier = await Tier.findById(progress.currentTierId);
//     if (!tier) throw new Error("Tier not found for progress");

//     const currentLevel = tier.levels.find(
//       (l) => l.levelNumber === progress.currentLevel
//     );
//     if (!currentLevel) throw new Error("Current level not found in tier");

//     // ⭐ UPDATED: REBUILD goalProgress IF LEVEL CHANGED
//     if (
//       !progress.goalProgress ||
//       progress.goalProgress.length !== currentLevel.goals.length ||
//       !progress.goalProgress.every((pg) =>
//         currentLevel.goals.some((g) => g._id.toString() === pg.goalId)
//       )
//     ) {
//       progress.goalProgress = currentLevel.goals.map((g) => ({
//         goalId: g._id.toString(),
//         goalType: g.goalType,
//         target: g.target,
//         progress: 0,
//         isCompleted: false,
//       }));

//       await progress.save();
//     }

//     const goals = currentLevel.goals;

//     // 5️⃣ Build structured goal progress list
//     const goalData = goals.map((g) => {
//       const gp = progress.goalProgress.find(
//         (p) => p.goalId === g._id.toString()
//       );

//       return {
//         goalId: g._id.toString(),
//         goalType: g.goalType,
//         target: g.target,
//         progress: gp ? gp.progress : 0,
//         isCompleted: gp ? gp.isCompleted : false,
//       };
//     });

//     // 6️⃣ LEVEL PROGRESS CALC
//     let totalPercent = 0;

//     goals.forEach((g) => {
//       const gp = progress.goalProgress.find(
//         (p) => p.goalId === g._id.toString()
//       );
//       const current = gp ? gp.progress : 0;

//       totalPercent += g.target > 0 ? Math.min(current / g.target, 1) : 1;
//     });

//     const totalGoals = goals.length || 1;
//     let progressPercent = Math.round((totalPercent / totalGoals) * 100);

//     // 🔥7️⃣ Dynamic Next Step
//     const nextLevel = tier.levels.find(
//       (lvl) => lvl.levelNumber === currentLevel.levelNumber + 1
//     );

//     let nextStep = { type: "", value: "" };

//     const isLastLevel = !nextLevel;
//     const isLastTier = !(await Tier.findOne({
//       adminId,
//       platformId,
//       order: tier.order + 1,
//       isActive: true,
//     }));

//     const allGoalsCompleted = goalData.every((g) => g.isCompleted);

//     if (!isLastLevel) {
//       nextStep = { type: "NEXT_LEVEL", value: nextLevel.levelNumber };
//     } else if (!isLastTier) {
//       const nextTier = await Tier.findOne({
//         adminId,
//         platformId,
//         order: tier.order + 1,
//         isActive: true,
//       });

//       nextStep = { type: "NEXT_TIER", value: nextTier.tierName };
//     } else {
//       if (allGoalsCompleted) {
//         nextStep = { type: "COMPLETED_ALL", value: null };
//         progressPercent = 100;
//       } else {
//         nextStep = {
//           type: "STAY_ON_LAST_LEVEL",
//           value: currentLevel.levelNumber,
//         };
//       }
//     }

//     // 8️⃣ Pending rewards (LEVEL-BASED LOGS)
//     const rawPendingRewards = await TierRewardLog.find({
//       userId,
//       adminId,
//       platformId,
//       isClaimed: false,
//       action: "REWARD_EARNED",
//     }).lean();

//     // 9️⃣ Past rewards (claimed)
//     const rawPastRewards = await TierRewardLog.find({
//       userId,
//       adminId,
//       platformId,
//       isClaimed: true,
//     })
//       .sort({ createdAt: -1 })
//       .lean();

//     // GROUPING HELPERS (still by rewardMethod)
//     const groupRewards = (list = []) => ({
//       scratch: list.filter((r) => r.rewardMethod === "SCRATCHCARD"),
//       spin: list.filter((r) => r.rewardMethod === "SPIN"),
//     });

//     // UPCOMING REWARDS from current/next level definition
//     const rawUpcomingRewards = currentLevel.rewards;

//     const upcomingRewards = {
//       scratch:
//         nextLevel?.rewardMethod === "SCRATCHCARD" ? rawUpcomingRewards : [],
//       spin: nextLevel?.rewardMethod === "SPIN" ? rawUpcomingRewards : [],
//     };

//     const pendingRewards = groupRewards(rawPendingRewards);
//     const pastRewards = groupRewards(rawPastRewards);

//     // ⭐ ALL rewards (earned + collected) — used by BuildRedeemableRewards
//     const rawAllRewards = [...rawPendingRewards, ...rawPastRewards];

//     const redeemableRewards = BuildRedeemableRewards(rawAllRewards, tier);

//     // 🔐10️⃣ BUILD RESPONSE
//     const safePayload = clean({
//       currentStatus: {
//         tierName: tier.tierName,
//         level: currentLevel.levelNumber,
//         currentTierLevel: tier.order,
//         progressPercent,
//       },

//       nextStep,
//       levels: tier.levels,
//       goals: goalData,

//       history: progress.progressHistory,

//       // pendingRewards,
//       // upcomingRewards,
//       // pastRewards,
//       redeemableRewards,
//       allRewards: rawAllRewards,

//       debug: {
//         currentTierId: progress.currentTierId,
//         currentLevel: progress.currentLevel,
//         goalProgress: progress.goalProgress,
//       },
//     });

//     const encryptedData = encryptData(safePayload);

//     return res.status(200).json({
//       success: true,
//       data: encryptedData,
//     });
//   } catch (err) {
//     console.error("Error fetching tier progress:", err);
//     next(err);
//   }
// };
