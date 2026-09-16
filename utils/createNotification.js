// utils/createNotification.js

import AffUser from "../models/aff-user.js";
import { UserActionEnum, UserCategoryEnum } from "../models/enum.js";
import AffiliateNotifications from "../models/notificationSchema.js";

export async function createNotification({
  userId,
  action = UserActionEnum.NEW_USER,
  recipientType = "USER",
  category = UserCategoryEnum.GENERAL,
  message,
  metadata = {},
}) {
  try {
    // 1️⃣ Check user notification preference (members only)
    const user = await AffUser.findById(userId)
      .select("notifications.isOn userType")
      .lean();

    const isAdminRecipient =
      recipientType === "ADMIN" || recipientType === "SUPER_ADMIN";

    // 🔕 Member notifications OFF → skip silently (admin inbox always written)
    if (!isAdminRecipient && !user?.notifications?.isOn) {
      return;
    }

    await AffiliateNotifications.create({
      user: userId,
      action,
      recipientType,
      category,
      message,
      metadata,
    });
  } catch (err) {
    console.error("🔥 Notification Error:", err.message);
  }
}
