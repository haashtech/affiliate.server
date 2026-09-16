import { UserActionEnum, UserCategoryEnum } from "../models/enum.js";
import AffiliateNotifications from "../models/notificationSchema.js";
import { notifyAdmin } from "./notifyAdmin.js";

/**
 * Creates payout notifications for both user and admin
 * @param {Object} params
 * @param {Object} params.user - The affiliate user receiving the commission
 * @param {Object} params.admin - The admin/company paying the commission
 * @param {Object} params.campaign - The campaign associated with the payout
 * @param {Number} params.amount - The commission amount paid
 */
export const createCommissionNotifications = async ({
  user,
  admin,
  campaign,
  amount,
}) => {
  if (!user || !admin || !campaign || !amount) return;

  try {
    // 🟢 For User (respect preference)
    if (user.notifications?.isOn !== false) {
      await AffiliateNotifications.create({
        user: user._id,
        action: UserActionEnum.COMMISSION_PAYOUT,
        recipientType: "USER",
        category: UserCategoryEnum.EARNINGS,
        message: `New commission of ₹${amount} credited for campaign "${campaign.campaignAccessKey}" from company "${admin.userName}".`,
        messageType: "Commission payout processed",
        metadata: {
          campaignId: campaign._id,
          adminId: admin._id,
          amount,
        },
      });
    }

    // 🔵 For Admin inbox (Recent Activities / notifications page)
    await notifyAdmin({
      adminId: admin._id,
      action: UserActionEnum.COMMISSION_PAYOUT,
      category: UserCategoryEnum.PAYOUT,
      message: `New commission of ₹${amount} paid to "${user.userName || user.fullName}" for campaign "${campaign.campaignAccessKey}".`,
      metadata: {
        userId: user._id,
        campaignId: campaign._id,
        amount,
      },
    });

    console.log(
      `📩 Notifications created for user ${user._id} and admin ${admin._id}`
    );
  } catch (err) {
    console.error("❌ Error creating commission notifications:", err.message);
  }
};
