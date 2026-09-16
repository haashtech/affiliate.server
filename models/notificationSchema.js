import mongoose from "mongoose";
import { UserActionEnum, UserCategoryEnum } from "./enum.js";

const NotificationsSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    action: {
      type: String,
      enum: Object.values(UserActionEnum),
      required: true,
    },
    // recipientType: {
    //   type: String,
    //   enum: ["user", "admin"],
    //   required: true,
    // },
    recipientType: {
      type: String,
      enum: ["USER", "ADMIN", "SUPER_ADMIN"],
      required: true,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    // optional type for categorization (payout, account, referral, etc.)
    category: {
      type: String,
      enum: Object.values(UserCategoryEnum),
      default: UserCategoryEnum.GENERAL,
    },

    metadata: { type: Object, default: {} }, // store extra info (method, IP, etc.)
    message: String,
    messageType: {
      type: String,
      default: function () {
        switch (this.action) {
          case UserActionEnum.SET_PIN:
            return "Withdrawal PIN set";
          case UserActionEnum.CHANGE_PIN:
            return "Withdrawal PIN changed";
          case UserActionEnum.WITHDRAWAL_ACCEPT:
            return "Withdrawal accepted";
          case UserActionEnum.WITHDRAWAL_REJECT:
            return "Withdrawal rejected";
          case UserActionEnum.WITHDRAWAL_REQUEST:
            return "Withdrawal requested";
          case UserActionEnum.CHANGE_PASSWORD:
            return "Password changed";
          case UserActionEnum.CAMPAIGN_STARTED:
            return "User started the campaign";
          case UserActionEnum.ACCOUNT_DELETION:
            return "User deleted the account permanently";
          case UserActionEnum.USER_REFER:
            return "User used the referral link";
          case UserActionEnum.COMMISSION_PAYOUT:
            return "Commission payout processed";
          case UserActionEnum.REWARD_CLAIM:
            return "User Claimed a reward";
          case UserActionEnum.REWARD_EARN:
            return "You Earned a reward";
          case UserActionEnum.WITHDRAWAL_COMPLETED:
            return "Withdrawal completed";
          case UserActionEnum.WITHDRAWAL_CANCELLED:
            return "Withdrawal cancelled";
          case UserActionEnum.NEW_USER:
            return "New affiliate application";
          case UserActionEnum.USER_STATUS_CHANGE:
            return "Affiliate status updated";
          case UserActionEnum.CAMPAIGN_CREATED:
            return "Campaign created";
          case UserActionEnum.CAMPAIGN_PAUSED:
            return "Campaign paused";
          case UserActionEnum.CAMPAIGN_ENDED:
            return "Campaign ended";
          case UserActionEnum.COLLABORATION:
            return "New collaboration request";
          default:
            return "User action recorded";
        }
      },
    },
    // updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

const AffiliateNotifications =
  mongoose.models.Notifications ||
  mongoose.model("Notifications", NotificationsSchema);

export default AffiliateNotifications;
