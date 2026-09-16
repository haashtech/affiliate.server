import { clean } from "../../helper/json-cleaner.js";
import AffiliateNotifications from "../../models/notificationSchema.js";
import { encryptData } from "../../utils/cript-data.js";
import { NotFoundError } from "../../utils/errors.js";

// ====================================================================================
// ========================= get admin all notifications ==============================
// ====================================================================================

export const allAdminNotifications = async (req, res, next) => {
  try {
    const adminId = req.admin?._id;

    if (!adminId) {
      throw new NotFoundError("Admin not detected");
    }

    // ✅ SAFE destructuring (req.body can be undefined)
    const {
      isPaginate = "true",
      page = 1,
      numberOfItems = 10,
    } = req.query || {};

    console.log(isPaginate);

    // ✅ convert explicitly
    const paginate = isPaginate === "true";

    const currentPage = Math.max(Number(page), 1);
    const limit = Math.max(Number(numberOfItems), 1);
    const skip = (currentPage - 1) * limit;

    const query = {
      user: adminId,
      // Admin inbox includes both ADMIN and SUPER_ADMIN-targeted rows
      // (some writers historically hard-coded "ADMIN").
      recipientType: { $in: ["ADMIN", "SUPER_ADMIN"] },
    };

    /* ----------------------------------------------------
       TOTAL COUNT
    ---------------------------------------------------- */
    const totalCount = await AffiliateNotifications.countDocuments(query);

    /* ----------------------------------------------------
       FETCH DATA
    ---------------------------------------------------- */
    let notificationsQuery = AffiliateNotifications.find(query)
      .populate("user", "fullName userName email avatar")
      .sort({ createdAt: -1 });

    if (paginate) {
      notificationsQuery = notificationsQuery.skip(skip).limit(limit);
    }

    const notifications = await notificationsQuery.lean();

    /* ----------------------------------------------------
       PAGINATION META (must come BEFORE usage)
    ---------------------------------------------------- */
    const totalPages = paginate ? Math.ceil(totalCount / limit) : 1;

    /* ----------------------------------------------------
       BUILD SAFE PAYLOAD
    ---------------------------------------------------- */
    const safePayload = clean({
      pagination: {
        isPaginate: paginate,
        currentPage,
        numberOfItems: paginate ? limit : totalCount,
        itemsInCurrentPage: notifications.length,
        totalItems: totalCount,
        totalPages,
        hasNextPage: paginate ? currentPage < totalPages : false,
        hasPrevPage: paginate ? currentPage > 1 : false,
      },
      data: notifications,
    });

    /* ----------------------------------------------------
       ENCRYPT FINAL PAYLOAD
    ---------------------------------------------------- */
    const encryptedData = encryptData(safePayload);

    return res.status(200).json({
      success: true,
      data: encryptedData,
    });
  } catch (error) {
    next(error);
  }
};

// ====================================================================================
// ========================= delete admin notifications ================================
// ====================================================================================

export const deleteAdminNotifications = async (req, res, next) => {
  try {
    const adminId = req.admin?._id;

    if (!adminId) {
      throw new NotFoundError("Admin not detected");
    }

    const { ids } = req.body;

    // ✅ Validate input
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      throw new BadRequestError("Notification ids are required");
    }

    // ✅ Delete only this admin's notifications
    const result = await AffiliateNotifications.deleteMany({
      _id: { $in: ids },
      user: adminId,
      recipientType: { $in: ["ADMIN", "SUPER_ADMIN"] },
    });

    return res.status(200).json({
      success: true,
      deletedCount: result.deletedCount,
      message: `${result.deletedCount} notification(s) deleted successfully`,
    });
  } catch (error) {
    console.log(error);

    next(error);
  }
};

// ====================================================================================
// ========================= isRead admin notifications ================================
// ====================================================================================

export const admitAsReadAdminNotifications = async (req, res, next) => {
  try {
    const adminId = req.admin?._id;

    if (!adminId) {
      throw new NotFoundError("Admin not detected");
    }

    const { nId } = req.params;

    // ✅ Validate input
    if (!nId) {
      throw new BadRequestError("Notification id is required");
    }

    // ✅ Delete only this admin's notifications
    const result = await AffiliateNotifications.updateOne(
      {
        _id: nId,
        user: adminId,
        recipientType: { $in: ["ADMIN", "SUPER_ADMIN"] },
        isRead: false,
      },
      {
        $set: { isRead: true },
      }
    );

    if (result.matchedCount === 0) {
      throw new NotFoundError("Notification not found");
    }

        const encryptedData = encryptData(result);


    return res.status(200).json({
      success: true,
      message: "Notification marked as read",
      count: result.modifiedCount,
      data: encryptedData,

    });
  } catch (error) {
    console.log(error);

    next(error);
  }
};
