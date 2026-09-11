import cron from "node-cron";
import AffUser from "../models/aff-user.js";
import { Commissions } from "../models/commissionSchema.js";
import { createCommissionNotifications } from "../utils/createCommissionNotifications.js";
import { addCommissionToWallet } from "../helper/wallet.js";
import { DailyActionUpdater } from "../utils/recordAction.js";

cron.schedule("0 0 * * *", async () => {
  console.log("🔄 Running commission payout job...");

  try {
    const pendingRecords = await Commissions.find({
      status: { $in: ["PENDING", "HOLD"] },
    })
      .populate("campaignId")
      .populate("adminId");

    let totalUpdated = 0;

    for (const record of pendingRecords) {
      const campaign = record.campaignId;
      const admin = record.adminId;
      const priorStatus = record.status;

      if (!campaign) {
        if (priorStatus === "HOLD") {
          console.log(
            `HOLD commission skipped: campaign not found (${record._id})`
          );
        }
        continue;
      }

      // HOLD may release only when the campaign is ACTIVE again
      if (priorStatus === "HOLD" && campaign.status !== "ACTIVE") {
        console.log(
          `HOLD commission skipped: campaign still ${campaign.status} (${record._id})`
        );
        continue;
      }

      const user = await AffUser.findById(campaign.userId);
      if (!user) continue;

      const createdDate = new Date(record.createdAt);
      const now = new Date();

      const diffDays = Math.floor(
        (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      const returnPeriod =
        campaign.returnPeriod && campaign.returnPeriod > 0
          ? campaign.returnPeriod
          : 1;

      // Wait one extra day after return period ends (same rule for PENDING and HOLD)
      if (diffDays >= returnPeriod + 1) {
        // Atomic claim: only one worker may transition PENDING/HOLD → PAID
        const claimed = await Commissions.findOneAndUpdate(
          {
            _id: record._id,
            status: { $in: ["PENDING", "HOLD"] },
          },
          { $set: { status: "PAID" } },
          { new: true }
        );

        if (!claimed) {
          console.log(
            `⏭ Commission skipped: no longer claimable (${record._id})`
          );
          continue;
        }

        const amt = claimed.finalCommission;

        await addCommissionToWallet({
          userId: user._id,
          adminId: campaign.company.accountId,
          commissionRecord: claimed,
        });

        // Legacy User.payouts / User.commissionDetails are not updated here
        // (Wallet + Commissions + Campaign are the live money sources of truth).

        const purchaseAmount = claimed.purchaseAmount;
        const commissionPercentage =
          purchaseAmount > 0 ? (amt / purchaseAmount) * 100 : 0;

        campaign.commissionDetails.totalCommissionPercentage =
          commissionPercentage;
        campaign.commissionDetails.pendingCommission -= amt;
        campaign.commissionDetails.paidCommission += amt;
        await campaign.save();

        await new DailyActionUpdater(user._id, admin)
          .increment("paidCommission", amt)
          .apply();

        await createCommissionNotifications({
          user,
          admin,
          campaign,
          amount: amt,
        });

        totalUpdated++;
        if (priorStatus === "HOLD") {
          console.log(
            `HOLD commission released: campaign ACTIVE and return period elapsed (${record._id})`
          );
        }
        console.log(
          `✅ Paid ${amt} to user ${user._id} for record ${record._id}`
        );
      }
    }

    console.log(
      `🎉 Commission payout job completed. ${totalUpdated} records updated.`
    );
  } catch (err) {
    console.error("❌ Error in payout job:", err);
  }
});
