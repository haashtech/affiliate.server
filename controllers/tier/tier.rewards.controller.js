// controllers/tier/collectRewardController.js

import { TierRewardLog } from "../../models/tier-models/tierRewardLogsSchema.js";
import { createNotification } from "../../utils/createNotification.js";
import { UserActionEnum, UserCategoryEnum } from "../../models/enum.js";
import { clean } from "../../helper/json-cleaner.js";
import { encryptData } from "../../utils/cript-data.js";
import {
  BadRequestError,
  MissingFieldError,
  NotFoundError,
} from "../../utils/errors.js";
import AffUser from "../../models/aff-user.js";
import { addCashRewardToWallet } from "../../helper/wallet.js";

const isCashReward = (item) =>
  item?.rewardType === "CASH" || item?.valueType === "currency";

const assertPaidStatusLock = (previousStatus, nextStatus) => {
  if (
    previousStatus === "PAID" &&
    (nextStatus === "PENDING" || nextStatus === "PROCESSING")
  ) {
    throw new BadRequestError(
      "Paid rewards cannot be changed back to Pending or Processing"
    );
  }
};

const creditCashRewardIfNeeded = async ({
  item,
  previousStatus,
  nextStatus,
  userId,
  adminId,
}) => {
  if (previousStatus === "PAID" || nextStatus !== "PAID") return;
  if (!isCashReward(item)) return;

  await addCashRewardToWallet({
    userId,
    adminId,
    rewardId: item._id,
    amount: item.value,
  });
};

export const claimUserRewardController = async (req, res, next) => {
  try {
    const { rewardLogId, rewardId } = req.body;
    const userId = req.user._id;

    if (!rewardLogId || !rewardId) {
      throw new Error("rewardLogId and rewardId are required");
    }

    // 1️⃣ GET THE REWARD LOG
    const log = await TierRewardLog.findOne({ _id: rewardLogId, userId });

    if (!log) throw new Error("Reward log not found");

    // 2️⃣ BLOCK if no spins OR already claimed OR already collected
    if (log.spinCount <= 0 || log.isCollected || log.isClaimed) {
      throw new Error("Reward already collected");
    }

    // 3️⃣ FIND the reward inside log
    const reward = log.rewards.find((r) => r.levelRewardId === rewardId);

    if (!reward) throw new Error("Selected reward not found in log");

    // 4️⃣ PUSH new collected reward snapshot (ARRAY)
    log.collectedRewards.push({
      rewardType: reward.rewardType,
      label: reward.rewardLabel,
      value: reward.rewardValue,
      valueType: reward.valueType,
      color: reward.color,
      textColor: reward.textColor,
      image: reward.image,
      isActive: reward.isActive,
      isClaimed: true,
      isCollected: false,
      claimedAt: new Date(),
      // collectedAt: new Date(),
    });

    // console.log(log.spinCount, "remaining spins before collection");

    // 5️⃣ UPDATE global log state
    log.spinCount = log.spinCount - 1;

    // console.log(log.spinCount, "remaining spins after collection");

    // When all spins are used → close the log permanently
    if (log.spinCount <= 0) {
      log.isClaimed = true;
      // log.isCollected = true;
      log.claimedAt = new Date();
      // log.collectedAt = new Date();
      log.action = "REWARD_COLLECTED";
    }

    await log.save();

    // 6️⃣ Create Notification
    await createNotification({
      userId,
      action: UserActionEnum.REWARD_CLAIM,
      recipientType: "USER",
      category: UserCategoryEnum.REWARD,
      message: `You collected reward: ${reward.rewardLabel}`,
      metadata: {
        rewardLogId,
        rewardId,
        tierId: log.tierId,
        levelNumber: log.levelNumber,
      },
    });

    const safePayload = clean({
      collectedRewards: log.collectedRewards,
      log,
    });

    const encryptedData = encryptData(safePayload);

    return res.json({
      message: "Reward collected successfully",
      data: encryptedData,
    });
  } catch (err) {
    console.error("collectRewardController error", err);
    next(err);
  }
};

export const getUserRewardsForTheirAdmins = async (req, res, next) => {
  try {
    const adminId = req.admin._id;

    const adminData = await AffUser.findById(adminId).select("collaborateWith");

    if (!adminData) {
      throw new NotFoundError("Admin not found");
    }

    const collaboratorIds = adminData.collaborateWith
      .filter((c) => c.status === "ACCEPTED")
      .map((c) => c.accountId);

    collaboratorIds.push(adminId);

    const logs = await TierRewardLog.find({
      adminId,
      userId: { $in: collaboratorIds },
      // action: { $nin: ["TIER_COMPLETED", "REWARD_TERMINATED"] },
      action: { $nin: ["TIER_COMPLETED"] },
    })
      .populate("userId", "fullName userName email avatar mobile")
      .populate("tierId", "tierName order isActive description")
      .sort({ createdAt: -1 })
      .lean();

    /* ---------------------------------------------------
       DERIVED REWARDS FOR FRONTEND
    --------------------------------------------------- */

    const cancelledRewards = [];
    const pendingRewards = [];

    logs.forEach((log) => {
      (log.collectedRewards || []).forEach((reward) => {
        const base = {
          ...reward,
          rewardLogId: log._id,
          userId: log.userId,
          tierId: log.tierId,
          logStatus: log.status,
          action: log.action,
        };

        if (reward.status === "CANCELLED") {
          cancelledRewards.push({
            ...base,
            cancelledAt: reward.cancelledAt,
          });
        }

        if (reward.status === "PENDING") {
          pendingRewards.push({
            ...base,
            claimedAt: reward.claimedAt,
          });
        }
      });
    });

    /* ---------------------------------------------------
       LOG-LEVEL DATA
    --------------------------------------------------- */

    const cancelledLogs = logs.filter((log) => log.status === "CANCELLED");

    /* ---------------------------------------------------
       SUMMARY (for frontend counters)
    --------------------------------------------------- */

    const summary = {
      totalLogs: logs.length,
      cancelledLogsCount: cancelledLogs.length,
      cancelledRewardsCount: cancelledRewards.length,
      pendingRewardsCount: pendingRewards.length,
      activeLogsCount: logs.filter((l) => l.status !== "CANCELLED").length,
    };

    const safePayload = clean({
      summary,
      cancelledRewards,
      pendingRewards,
      cancelledLogs,
      logs,
    });

    /* ---------------------------------------------------
       ENCRYPT MAIN DATA (unchanged)
    --------------------------------------------------- */

    const encryptedLogs = encryptData(safePayload);

    return res.status(200).json({
      success: true,
      total: logs.length,
      data: encryptedLogs,
    });
  } catch (error) {
    next(error);
  }
};

export const updateClaimedRewards = async (req, res, next) => {
  try {
    const adminId = req.admin._id;
    const rewardLogId = req.params.rewardLogId;

    const { rewardId, status } = req.body;

    if (!status) {
      throw new MissingFieldError("status required");
    }

    const log = await TierRewardLog.findOne({
      _id: rewardLogId,
      adminId,
    }).populate("userId")

    if (!log) {
      throw new NotFoundError("Reward log not found");
    }

    /* -------------------------------------------------------------
       CASE 1 → rewardId PROVIDED → update single collectedReward
    -------------------------------------------------------------- */
    if (rewardId) {
      const rewardItem = log.collectedRewards.id(rewardId);

      if (!rewardItem) {
        throw new NotFoundError("Reward item not found in collectedRewards");
      }

      const previousStatus = rewardItem.status;
      assertPaidStatusLock(previousStatus, status);

      await creditCashRewardIfNeeded({
        item: rewardItem,
        previousStatus,
        nextStatus: status,
        userId: log.userId._id,
        adminId,
      });

      rewardItem.status = status;

      if (status === "PAID") {
        rewardItem.deliveredAt = new Date();
        rewardItem.isCollected = true;
        rewardItem.collectedAt = new Date();
      }

      if (status === "PROCESSING") {
        rewardItem.collectedAt = new Date();
        rewardItem.isCollected = true;
      }

      if (status === "CANCELLED") {
        rewardItem.collectedAt = new Date();
        rewardItem.cancelledAt = new Date();
      }
    }

    /* -------------------------------------------------------------
       CASE 2 → rewardId NOT PROVIDED → update ALL collectedRewards
    -------------------------------------------------------------- */
    if (!rewardId) {
      for (const item of log.collectedRewards) {
        const previousStatus = item.status;
        assertPaidStatusLock(previousStatus, status);

        await creditCashRewardIfNeeded({
          item,
          previousStatus,
          nextStatus: status,
          userId: log.userId._id,
          adminId,
        });

        item.status = status;

        if (status === "PAID") {
          item.deliveredAt = new Date();
          item.collectedAt = new Date();
          item.isCollected = true;
        }

        if (status === "PROCESSING") {
          item.collectedAt = new Date();
          item.isCollected = true;
        }

        if (status === "CANCELLED") {
          item.cancelledAt = new Date();
          item.collectedAt = new Date();
          item.isCollected = true;
        }
      }
    }

    /* -------------------------------------------------------------
       LOG-LEVEL UPDATES (applies to both cases)
    -------------------------------------------------------------- */

    // If cancelling everything
    if (status === "CANCELLED") {
      log.status = "CANCELLED";

      if (log.collectedRewards.length === 1 || !rewardId) {
        log.action = "REWARD_TERMINATED";
      }
    }

    // If paid
    if (status === "PAID") {
      log.status = "PAID";

      if (log.spinCount === 0 || !rewardId) {
        log.isDelivered = true;
        log.deliveredAt = new Date();
        log.action = "REWARD_GIVEN";
      }
    }

    // 🔔 Notify USER
    await createNotification({
      userId: log.userId._id,
      recipientType: "USER",
      action:UserActionEnum.REWARD_STATUS_CHANGE,
      category: UserCategoryEnum.REWARD,
      message: `Your reward has been ${status.toLowerCase()}`,
      metadata: {
        rewardLogId: log._id,
        status,
      },
    });

    // 🔔 Notify CURRENT ADMIN (normal or super)
    await createNotification({
      userId: adminId,
      recipientType: req.admin.userType,
      action: UserActionEnum.REWARD_STATUS_CHANGE,
      category: UserCategoryEnum.REWARD,
      message: `Reward ${status.toLowerCase()} for user ${log.userId.fullName}`,
      metadata: {
        rewardLogId: log._id,
        userId: log.userId._id,
        status,
      },
    });

    /* -------------------------------------------------------------
       SAVE
    -------------------------------------------------------------- */
    await log.save();

    return res.status(200).json({
      message: rewardId
        ? "Reward updated successfully"
        : "All rewards updated successfully",
    });
  } catch (error) {
    console.log(error);
    next(error);
  }
};

// export const updateClaimedRewards = async (req, res, next) => {
//   try {
//     const adminId = req.admin._id;
//     const rewardLogId = req.params.rewardLogId;

//     const { rewardId, status } = req.body;

//     if (!status) {
//       throw new MissingFieldError("status required");
//     }

//     const log = await TierRewardLog.findOne({
//       _id: rewardLogId,
//       adminId,
//     });

//     if (!log) {
//       throw new NotFoundError("Reward log not found");
//     }

//     /* -------------------------------------------------------------
//        STEP 1 → Always update inside collectedRewards[]
//     -------------------------------------------------------------- */
//     const rewardItem = log.collectedRewards.id(rewardId);

//     if (!rewardItem) {
//       throw new NotFoundError("Reward item not found in collectedRewards");
//     }

//     rewardItem.status = status;

//     if (status === "PAID") {
//       // rewardItem.isCollected = true;
//       rewardItem.deliveredAt = new Date();
//     }

//     if (status === "CANCELLED") {
//       if (log.collectedRewards.length === 1) {
//         log.action = "REWARD_TERMINATED";
//       }
//       log.status = "CANCELLED";
//       rewardItem.status = "CANCELLED";
//       rewardItem.cancelledAt = new Date();
//     }

//     /* -------------------------------------------------------------
//        STEP 2 → If spinCount = 0 → update main log as well
//     -------------------------------------------------------------- */
//     if (log.spinCount === 0) {
//       log.status = status;

//       if (status === "PAID") {
//         log.isDelivered = true;
//         log.deliveredAt = new Date();
//         log.action = "REWARD_GIVEN";
//       }
//     }

//     /* -------------------------------------------------------------
//        STEP 3 → Save
//     -------------------------------------------------------------- */
//     await log.save();

//     return res.status(200).json({
//       message: "Reward updated successfully",
//     });
//   } catch (error) {
//     console.log(error);
//     next(error); // ⬅ passes error to global handler
//   }
// };
