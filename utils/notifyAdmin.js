import AffUser from "../models/aff-user.js";
import { UserActionEnum, UserCategoryEnum } from "../models/enum.js";
import AffiliateNotifications from "../models/notificationSchema.js";

/**
 * Write an admin-inbox notification for Recent Activities / notifications UI.
 * Always targets the company admin document (`user` = adminId).
 * Skips member notification prefs so operational events still appear.
 */
export async function notifyAdmin({
  adminId,
  action,
  category = UserCategoryEnum.GENERAL,
  message,
  metadata = {},
  recipientType,
}) {
  if (!adminId || !action || !message) return null;

  try {
    const admin = await AffUser.findById(adminId)
      .select("userType")
      .lean();

    if (!admin) {
      console.warn("notifyAdmin: admin not found", String(adminId));
      return null;
    }

    const type =
      recipientType ||
      (admin.userType === "SUPER_ADMIN" ? "SUPER_ADMIN" : "ADMIN");

    return await AffiliateNotifications.create({
      user: adminId,
      action,
      recipientType: type,
      category,
      message,
      metadata,
    });
  } catch (err) {
    console.error("notifyAdmin error:", err.message);
    return null;
  }
}

/** Notify every SUPER_ADMIN (e.g. unscoped new registrations). */
export async function notifyAllSuperAdmins({
  action = UserActionEnum.NEW_USER,
  category = UserCategoryEnum.REGISTRATION,
  message,
  metadata = {},
}) {
  if (!message) return;

  try {
    const supers = await AffUser.find({ userType: "SUPER_ADMIN" })
      .select("_id userType")
      .lean();

    await Promise.all(
      supers.map((admin) =>
        notifyAdmin({
          adminId: admin._id,
          action,
          category,
          message,
          metadata,
          recipientType: "SUPER_ADMIN",
        })
      )
    );
  } catch (err) {
    console.error("notifyAllSuperAdmins error:", err.message);
  }
}

export function campaignActionFromStatus(status) {
  const s = String(status || "").toUpperCase();
  if (s === "ACTIVE") return UserActionEnum.CAMPAIGN_STARTED;
  if (s === "PAUSED") return UserActionEnum.CAMPAIGN_PAUSED;
  if (s === "ENDED" || s === "COMPLETED" || s === "INACTIVE") {
    return UserActionEnum.CAMPAIGN_ENDED;
  }
  return null;
}
