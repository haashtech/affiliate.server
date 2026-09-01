// engines/TierProgressEngine.js
import { UserActionEnum, UserCategoryEnum } from "../../models/enum.js";
import { TierRewardLog } from "../../models/tier-models/tierRewardLogsSchema.js";
import { Tier } from "../../models/tier-models/tierSystemSchema.js";
import { UserTierProgress } from "../../models/tier-models/tierUserProgressSchema.js";
import { createNotification } from "../../utils/createNotification.js";
import {
  getFirstActiveLevel,
  getNextTier,
  getStartingTier,
} from "./tierQueries.js";

export default class TierProgressEngine {
  constructor({ user, adminId, platformId }) {
    this.user = user;
    this.adminId = adminId;
    this.platformId = platformId;
  }

  /* ------------------------------------------
   * Helper: build goalProgress from a level
   * ------------------------------------------ */
  buildGoalProgressFromLevel(level) {
    if (!level) return [];
    return level.goals.map((g) => ({
      goalId: g._id.toString(),
      goalType: g.goalType,
      target: g.target,
      progress: 0,
      isCompleted: false,
    }));
  }

  /* ------------------------------------------
   * Ensure progress doc exists
   * ------------------------------------------ */
  async ensureProgressDoc() {
    let doc = await UserTierProgress.findOne({
      userId: this.user._id,
      adminId: this.adminId,
      platformId: this.platformId,
    });

    // First time user → assign starting tier + level
    if (!doc) {
      const firstTier = await getStartingTier(this.adminId, this.platformId);

      if (!firstTier) return null;

      const firstLevel = getFirstActiveLevel(firstTier);

      doc = await UserTierProgress.create({
        userId: this.user._id,
        adminId: this.adminId,
        platformId: this.platformId,
        currentTierId: firstTier._id,
        currentLevel: firstLevel ? firstLevel.levelNumber : 1,
        isTierCompleted: false,
        goalProgress: this.buildGoalProgressFromLevel(firstLevel),
      });

      return doc;
    }

    // --- If user had completed all tiers before, but admin added new tier later ---
    if (doc.isTierCompleted) {
      const currentTier = doc.currentTierId
        ? await Tier.findById(doc.currentTierId)
        : null;

      const currentOrder = currentTier?.order ?? 0;

      const nextTier = await getNextTier(
        this.adminId,
        this.platformId,
        currentOrder
      );

      if (nextTier) {
        const firstLevel = getFirstActiveLevel(nextTier);

        doc.currentTierId = nextTier._id;
        doc.currentLevel = firstLevel ? firstLevel.levelNumber : 1;
        doc.goalProgress = this.buildGoalProgressFromLevel(firstLevel);
        doc.isTierCompleted = false;
        await doc.save();
      }
    }

    // ⭐ UPDATED: rebuild goalProgress if it doesn't match current level definition
    const tier = await Tier.findById(doc.currentTierId);
    const level =
      tier?.levels.find(
        (l) => l.levelNumber === doc.currentLevel && l.isActive
      ) || null;

    if (level) {
      if (
        !doc.goalProgress ||
        doc.goalProgress.length !== level.goals.length ||
        !doc.goalProgress.every((pg) =>
          level.goals.some((g) => g._id.toString() === pg.goalId)
        )
      ) {
        doc.goalProgress = this.buildGoalProgressFromLevel(level);
        await doc.save();
      }
    }

    return doc;
  }

  /* ------------------------------------------
   * Increment goal progress (by goalType)
   * ------------------------------------------ */
  async incrementGoal(goalType, amount = 1) {
    const progress = await this.ensureProgressDoc();
    if (!progress) return;

    // stop if user fully done and no new tiers
    if (progress.isTierCompleted) return;

    const tier = await Tier.findById(progress.currentTierId);
    if (!tier || !tier.isActive) return;

    const level = tier.levels.find(
      (l) => l.levelNumber === progress.currentLevel
    );
    if (!level || !level.isActive) return;

    // Does this level even use this goalType?
    const levelHasGoalType = level.goals.some(
      (g) => g.goalType.toUpperCase() === goalType.toUpperCase()
    );
    if (!levelHasGoalType) return;

    // Find NEXT uncompleted goal of this type (sequential tasks)
    const nextGoal = level.goals.find((g) => {
      if (g.goalType.toUpperCase() !== goalType.toUpperCase()) return false;
      const gp = progress.goalProgress.find(
        (p) => p.goalId === g._id.toString()
      );
      return !gp || !gp.isCompleted;
    });

    if (!nextGoal) {
      // no remaining tasks of this type in this level
      return;
    }

    // Ensure progress entry exists for this goal
    let goalProg = progress.goalProgress.find(
      (p) => p.goalId === nextGoal._id.toString()
    );

    if (!goalProg) {
      goalProg = {
        goalId: nextGoal._id.toString(),
        goalType: nextGoal.goalType,
        target: nextGoal.target,
        progress: 0,
        isCompleted: false,
      };
      progress.goalProgress.push(goalProg);
    }

    // Increment ONLY this goal
    goalProg.progress += amount;

    if (goalProg.progress >= goalProg.target) {
      goalProg.isCompleted = true;
    }

    await progress.save();

    return this.checkLevelCompletion(tier, level, progress);
  }

  /* ------------------------------------------
   * Check if current level is completed
   * ------------------------------------------ */
  async checkLevelCompletion(tier, level, progress) {
    // Level is completed when ALL its goals are completed
    const allGoalsCompleted = level.goals.every((g) => {
      const gp = progress.goalProgress.find(
        (p) => p.goalId === g._id.toString()
      );
      return gp && gp.isCompleted;
    });

    if (!allGoalsCompleted) return;

    // Log rewards for this level (one log per level now)
    await this.grantRewards(level, tier);

    // Save history snapshot
    progress.progressHistory.push({
      tierId: tier._id,
      levelNumber: level.levelNumber,
      achievedAt: new Date(),
      goals: progress.goalProgress.map((g) => ({
        goalId: g.goalId,
        goalType: g.goalType,
        target: g.target,
        progress: g.progress,
        isCompleted: g.isCompleted,
      })),
    });

    // Move to next level, or complete tier
    const nextLevel = tier.levels.find(
      (l) => l.levelNumber === level.levelNumber + 1 && l.isActive
    );

    if (nextLevel) {
      progress.currentLevel = nextLevel.levelNumber;
      progress.goalProgress = this.buildGoalProgressFromLevel(nextLevel);
      await progress.save();
      return progress;
    }

    // No next level → tier completed
    await this.completeTier(tier, progress);
    await progress.save();
    return progress;
  }

  /* ------------------------------------------
   * Grant rewards (LEVEL-BASED LOGS)
   * ------------------------------------------ */
  // async grantRewards(level, tier) {
  //   // ⭐ SCRATCHCARD: store ONLY ONE RANDOM REWARD in rewards[0]
  //   if (level.rewardMethod === "SCRATCHCARD") {
  //     const activeRewards = level.rewards.filter((r) => r.isActive);

  //     if (activeRewards.length > 0) {
  //       const randomReward =
  //         activeRewards[Math.floor(Math.random() * activeRewards.length)];

  //       await TierRewardLog.create({
  //         adminId: this.adminId,
  //         platformId: this.platformId,
  //         userId: this.user._id,
  //         tierId: tier._id,
  //         levelNumber: level.levelNumber,
  //         levelId: level._id.toString(),
  //         rewardMethod: "SCRATCHCARD",
  //         rewards: [
  //           {
  //             levelRewardId: randomReward._id.toString(),
  //             rewardType: randomReward.rewardType,
  //             rewardLabel: randomReward.label,
  //             rewardValue: randomReward.value,
  //             valueType: randomReward.valueType,
  //             image: randomReward.image,
  //             isActive:randomReward.isActive
  //           },
  //         ],
  //         action: "REWARD_EARNED",
  //       });
  //     }

  //     return; // important — do not create more logs
  //   }

  //   // ⭐ SPIN: store ALL ACTIVE REWARDS for that level in a single log
  //   const activeRewards = level.rewards.filter((r) => r.isActive);
  //   if (!activeRewards.length) return;

  //   await TierRewardLog.create({
  //     adminId: this.adminId,
  //     platformId: this.platformId,
  //     userId: this.user._id,
  //     tierId: tier._id,
  //     levelNumber: level.levelNumber,
  //     levelId: level._id.toString(),
  //     rewardMethod: level.rewardMethod, // "SPIN"
  //     rewards: activeRewards.map((r) => ({
  //       levelRewardId: r._id.toString(),
  //       rewardType: r.rewardType,
  //       rewardLabel: r.label,
  //       rewardValue: r.value,
  //       valueType: r.valueType,
  //       image: r.image,
  //       isActive:r.isActive
  //     })),
  //     action: "REWARD_EARNED",
  //   });
  // }
  /* ------------------------------------------
   * Grant rewards (LEVEL-BASED LOGS)
   * ------------------------------------------ */
  async grantRewards(level, tier) {
    // ⭐ SCRATCHCARD: pick ONE RANDOM reward from ALL rewards (no filter)
    // if (level.rewardMethod === "SCRATCHCARD") {
    //   // const allRewards = level.rewards; // NO isActive filter
    //   const activeRewards = level.rewards.filter((r) => r.isActive === true);

    //   if (activeRewards.length > 0) {
    //     const randomReward =
    //       activeRewards[Math.floor(Math.random() * activeRewards.length)];

    //     await TierRewardLog.create({
    //       adminId: this.adminId,
    //       platformId: this.platformId,
    //       userId: this.user._id,
    //       tierId: tier._id,
    //       levelNumber: level.levelNumber,
    //       levelId: level._id.toString(),
    //       rewardMethod: "SCRATCHCARD",
    //       spinCount: level.spinCount,
    //       rewards: [
    //         {
    //           levelRewardId: randomReward._id.toString(),
    //           rewardType: randomReward.rewardType,
    //           rewardLabel: randomReward.label,
    //           rewardValue: randomReward.value,
    //           valueType: randomReward.valueType,
    //           image: randomReward.image,
    //           isActive: randomReward.isActive,
    //           color: randomReward.color,
    //           textColor: randomReward.textColor,
    //         },
    //       ],
    //       action: "REWARD_EARNED",
    //     });
    //   }

    //   return; // stop here for scratch card
    // }

    // ⭐ SPIN: save ALL rewards in the level, no filtering on isActive
    const allRewards = level.rewards;

    const log = await TierRewardLog.create({
      adminId: this.adminId,
      platformId: this.platformId,
      userId: this.user._id,
      tierId: tier._id,
      levelNumber: level.levelNumber,
      levelId: level._id.toString(),
      rewardMethod: level.rewardMethod, // "SPIN"
      spinCount: level.spinCount,
      rewards: allRewards.map((r) => ({
        levelRewardId: r._id.toString(),
        rewardType: r.rewardType,
        rewardLabel: r.label,
        rewardValue: r.value,
        valueType: r.valueType,
        image: r.image,
        isActive: r.isActive, // save active status to log\
        color: r.color,
        textColor: r.textColor,
      })),
      action: "REWARD_EARNED",
    });
    // 2️⃣ Send notification for each reward earned
    // for (const r of allRewards) {
    //   await createNotification({
    //     userId: this.user._id,
    //     action: UserActionEnum.REWARD_EARN,
    //     recipientType: "user",
    //     category: UserCategoryEnum.REWARD,
    //     message: `You earned a reward: ${r.label}`,
    //     metadata: {
    //       rewardLogId: log._id,
    //       rewardId: r._id.toString(),
    //       tierId: tier._id.toString(),
    //       levelNumber: level.levelNumber,
    //     },
    //   });
    // }
    // 2️⃣ Build combined message
    const rewardNames = allRewards.map((r) => r.rewardType).join(", ");

    const message =
      allRewards.length === 1
        ? `You earned a reward chance to earn: ${rewardNames}`
        : `You earned ${allRewards.length} rewards chance to earn: ${rewardNames}`;

    // 3️⃣ Send ONE notification only
    await createNotification({
      userId: this.user._id,
      action: UserActionEnum.REWARD_EARN,
      recipientType: "USER",
      category: UserCategoryEnum.REWARD,
      message,
      metadata: {
        rewardLogId: log._id.toString(),
        tierId: tier._id.toString(),
        levelNumber: level.levelNumber,
        rewards: allRewards.map((r) => ({
          rewardId: r._id.toString(),
          rewardLabel: r.label,
          rewardType: r.rewardType,
          value: r.value,
        })),
      },
    });

    return log;
  }

  /* ------------------------------------------
   * Complete tier → move to next tier or finish system
   * ------------------------------------------ */
  async completeTier(tier, progress) {
    // Log tier completion (no rewards[] needed here)
    await TierRewardLog.create({
      adminId: this.adminId,
      platformId: this.platformId,
      userId: this.user._id,
      tierId: tier._id,
      action: "TIER_COMPLETED",
    });

    // Find next tier
    const nextTier = await getNextTier(
      this.adminId,
      this.platformId,
      tier.order
    );

    if (nextTier) {
      const firstLevel = getFirstActiveLevel(nextTier);

      progress.currentTierId = nextTier._id;
      progress.currentLevel = firstLevel ? firstLevel.levelNumber : 1;
      progress.goalProgress = this.buildGoalProgressFromLevel(firstLevel);
      progress.isTierCompleted = false;
    } else {
      // No more tiers → mark user fully completed
      progress.isTierCompleted = true;
      // mark all goals as completed
      progress.goalProgress = progress.goalProgress.map((g) => ({
        ...g,
        progress: g.target,
        isCompleted: true,
      }));
    }
  }
}

// import { TierRewardLog } from "../../models/tier-models/tierRewardLogsSchema.js";
// import { Tier } from "../../models/tier-models/tierSystemSchema.js";
// import { UserTierProgress } from "../../models/tier-models/tierUserProgressSchema.js";

// export default class TierProgressEngine {
//   constructor({ user, adminId, platformId }) {
//     this.user = user;
//     this.adminId = adminId;
//     this.platformId = platformId;
//   }

//   /* ------------------------------------------
//    * Helper: build goalProgress from a level
//    * ------------------------------------------ */
//   buildGoalProgressFromLevel(level) {
//     if (!level) return [];
//     return level.goals.map((g) => ({
//       goalId: g._id.toString(),
//       goalType: g.goalType,
//       target: g.target,
//       progress: 0,
//       isCompleted: false,
//     }));
//   }

//   /* ------------------------------------------
//    * Ensure progress doc exists
//    * ------------------------------------------ */
//   async ensureProgressDoc() {
//     let doc = await UserTierProgress.findOne({
//       userId: this.user._id,
//       adminId: this.adminId,
//       platformId: this.platformId,
//     });

//     // First time user → assign first tier + level
//     if (!doc) {
//       const firstTier = await Tier.findOne({
//         adminId: this.adminId,
//         platformId: this.platformId,
//         isActive: true,
//       }).sort({ order: 1 });

//       if (!firstTier) return null;

//       const firstLevel =
//         firstTier.levels.find((l) => l.isActive && l.levelNumber === 1) ||
//         firstTier.levels.find((l) => l.isActive);

//       doc = await UserTierProgress.create({
//         userId: this.user._id,
//         adminId: this.adminId,
//         platformId: this.platformId,
//         currentTierId: firstTier._id,
//         currentLevel: firstLevel ? firstLevel.levelNumber : 1,
//         isTierCompleted: false,
//         goalProgress: this.buildGoalProgressFromLevel(firstLevel),
//       });

//       return doc;
//     }

//     // --- If user had completed all tiers before, but admin added new tier later ---
//     if (doc.isTierCompleted) {
//       const currentTier = doc.currentTierId
//         ? await Tier.findById(doc.currentTierId)
//         : null;

//       const currentOrder = currentTier?.order ?? 0;

//       const nextTier = await Tier.findOne({
//         adminId: this.adminId,
//         platformId: this.platformId,
//         order: { $gt: currentOrder },
//         isActive: true,
//       }).sort({ order: 1 });

//       if (nextTier) {
//         const firstLevel =
//           nextTier.levels.find((l) => l.isActive && l.levelNumber === 1) ||
//           nextTier.levels.find((l) => l.isActive);

//         doc.currentTierId = nextTier._id;
//         doc.currentLevel = firstLevel ? firstLevel.levelNumber : 1;
//         doc.goalProgress = this.buildGoalProgressFromLevel(firstLevel);
//         doc.isTierCompleted = false;
//         await doc.save();
//       }
//     }

//     // --- If for some reason goalProgress is empty, rebuild for current level ---
//     if (!doc.goalProgress || doc.goalProgress.length === 0) {
//       const tier = await Tier.findById(doc.currentTierId);
//       const level =
//         tier?.levels.find(
//           (l) => l.levelNumber === doc.currentLevel && l.isActive
//         ) || null;

//       if (level) {
//         doc.goalProgress = this.buildGoalProgressFromLevel(level);
//         await doc.save();
//       }
//     }

//     return doc;
//   }

//   /* ------------------------------------------
//    * Increment goal progress (by goalType)
//    * ------------------------------------------ */
//   async incrementGoal(goalType, amount = 1) {
//     const progress = await this.ensureProgressDoc();
//     if (!progress) return;

//     // stop if user fully done and no new tiers
//     if (progress.isTierCompleted) return;

//     const tier = await Tier.findById(progress.currentTierId);
//     if (!tier || !tier.isActive) return;

//     const level = tier.levels.find(
//       (l) => l.levelNumber === progress.currentLevel
//     );
//     if (!level || !level.isActive) return;

//     // Does this level even use this goalType?
//     const levelHasGoalType = level.goals.some(
//       (g) => g.goalType.toUpperCase() === goalType.toUpperCase()
//     );
//     if (!levelHasGoalType) return;

//     // Find NEXT uncompleted goal of this type (sequential tasks)
//     const nextGoal = level.goals.find((g) => {
//       if (g.goalType.toUpperCase() !== goalType.toUpperCase()) return false;
//       const gp = progress.goalProgress.find(
//         (p) => p.goalId === g._id.toString()
//       );
//       return !gp || !gp.isCompleted;
//     });

//     if (!nextGoal) {
//       // no remaining tasks of this type in this level
//       return;
//     }

//     // Ensure progress entry exists for this goal
//     let goalProg = progress.goalProgress.find(
//       (p) => p.goalId === nextGoal._id.toString()
//     );

//     if (!goalProg) {
//       goalProg = {
//         goalId: nextGoal._id.toString(),
//         goalType: nextGoal.goalType,
//         target: nextGoal.target,
//         progress: 0,
//         isCompleted: false,
//       };
//       progress.goalProgress.push(goalProg);
//     }

//     // Increment ONLY this goal
//     goalProg.progress += amount;

//     if (goalProg.progress >= goalProg.target) {
//       goalProg.isCompleted = true;
//     }

//     await progress.save();

//     return this.checkLevelCompletion(tier, level, progress);
//   }

//   /* ------------------------------------------
//    * Check if current level is completed
//    * ------------------------------------------ */
//   async checkLevelCompletion(tier, level, progress) {
//     // Level is completed when ALL its goals are completed
//     const allGoalsCompleted = level.goals.every((g) => {
//       const gp = progress.goalProgress.find(
//         (p) => p.goalId === g._id.toString()
//       );
//       return gp && gp.isCompleted;
//     });

//     if (!allGoalsCompleted) return;

//     // Log rewards for this level
//     await this.grantRewards(level, tier);

//     // Add history record // OLD
//     // progress.progressHistory.push({
//     //   tierId: tier._id,
//     //   levelNumber: level.levelNumber,
//     //   achievedAt: new Date(),
//     // });
//     // NEW — save goals snapshot also
//     progress.progressHistory.push({
//       tierId: tier._id,
//       levelNumber: level.levelNumber,
//       achievedAt: new Date(),
//       goals: progress.goalProgress.map((g) => ({
//         goalId: g.goalId,
//         goalType: g.goalType,
//         target: g.target,
//         progress: g.progress,
//         isCompleted: g.isCompleted,
//       })),
//     });

//     // Move to next level, or complete tier
//     const nextLevel = tier.levels.find(
//       (l) => l.levelNumber === level.levelNumber + 1 && l.isActive
//     );

//     if (nextLevel) {
//       progress.currentLevel = nextLevel.levelNumber;
//       progress.goalProgress = this.buildGoalProgressFromLevel(nextLevel);
//       await progress.save();
//       return progress;
//     }

//     // No next level → tier completed
//     await this.completeTier(tier, progress);
//     await progress.save();
//     return progress;
//   }

//   /* ------------------------------------------
//    * Grant rewards old saving all rewards
//    * ------------------------------------------ */
//   // async grantRewards(level, tier) {
//   //   for (const r of level.rewards) {
//   //     if (!r.isActive) continue;

//   //     await TierRewardLog.create({
//   //       adminId: this.adminId,
//   //       platformId: this.platformId,
//   //       userId: this.user._id,
//   //       tierId: tier._id,
//   //       levelNumber: level.levelNumber,
//   //       rewardType: r.rewardType,
//   //       rewardMethod: level.rewardMethod, // spin or scratch
//   //       rewardValue: r.value,
//   //       rewardLabel: r.label,
//   //       valueType: r.valueType,
//   //       action: "REWARD_EARNED",
//   //     });
//   //   }
//   // }

//   /* ------------------------------------------
//  * Grant rewards (with random scratchcard logic)
//  * ------------------------------------------ */
// async grantRewards(level, tier) {
//   // If rewardMethod = SCRATCHCARD → pick only ONE reward randomly
//   if (level.rewardMethod === "SCRATCHCARD") {
//     const activeRewards = level.rewards.filter(r => r.isActive);

//     if (activeRewards.length > 0) {
//       const randomReward =
//         activeRewards[Math.floor(Math.random() * activeRewards.length)];

//       await TierRewardLog.create({
//         adminId: this.adminId,
//         platformId: this.platformId,
//         userId: this.user._id,
//         tierId: tier._id,
//         levelNumber: level.levelNumber,
//         rewardType: randomReward.rewardType,
//         levelRewardId: randomReward._id.toString(),
//         rewardMethod: "SCRATCHCARD",
//         rewardValue: randomReward.value,
//         rewardLabel: randomReward.label,
//         valueType: randomReward.valueType,
//         image: randomReward.image,
//         action: "REWARD_EARNED",
//       });
//     }

//     return; // ❗ important — prevent inserting ALL rewards
//   }

//   // SPIN or NORMAL rewards → store all active rewards
//   for (const r of level.rewards) {
//     if (!r.isActive) continue;

//     await TierRewardLog.create({
//       adminId: this.adminId,
//       platformId: this.platformId,
//       userId: this.user._id,
//       tierId: tier._id,
//       levelNumber: level.levelNumber,
//       rewardType: r.rewardType,
//       rewardMethod: level.rewardMethod,
//       rewardValue: r.value,
//       rewardLabel: r.label,
//       levelRewardId: level._id.toString(), // ⭐ added
//       image: r.image,
//       valueType: r.valueType,
//       action: "REWARD_EARNED",
//     });
//   }
// }

//   /* ------------------------------------------
//    * Complete tier → move to next tier or finish system
//    * ------------------------------------------ */
//   async completeTier(tier, progress) {
//     // Log tier complete
//     await TierRewardLog.create({
//       adminId: this.adminId,
//       platformId: this.platformId,
//       userId: this.user._id,
//       tierId: tier._id,
//       action: "TIER_COMPLETED",
//     });

//     // Find next tier
//     const nextTier = await Tier.findOne({
//       adminId: this.adminId,
//       platformId: this.platformId,
//       order: { $gt: tier.order },
//       isActive: true,
//     }).sort({ order: 1 });

//     if (nextTier) {
//       const firstLevel =
//         nextTier.levels.find((l) => l.isActive && l.levelNumber === 1) ||
//         nextTier.levels.find((l) => l.isActive);

//       progress.currentTierId = nextTier._id;
//       progress.currentLevel = firstLevel ? firstLevel.levelNumber : 1;
//       progress.goalProgress = this.buildGoalProgressFromLevel(firstLevel);
//       progress.isTierCompleted = false;
//     } else {
//       // No more tiers → mark user fully completed
//       progress.isTierCompleted = true;
//       // progress.goalProgress = [];
//       progress.goalProgress = progress.goalProgress.length
//         ? progress.goalProgress
//         : level.goals.map((g) => ({
//             goalId: g._id.toString(),
//             goalType: g.goalType,
//             target: g.target,
//             progress: g.target,
//             isCompleted: true,
//           }));
//     }
//   }
// }
