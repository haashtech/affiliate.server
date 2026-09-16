import AffUser from "../../models/aff-user.js";
import { UserActionEnum, UserCategoryEnum } from "../../models/enum.js";
import { notifyAdmin } from "../../utils/notifyAdmin.js";

export const 
updateAffUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const { status, type, commission, commissionType, tdsType, isTdsEnabled } = req.body;
    // console.log(
    //   status,
    //   type,
    //   commission,
    //   commissionType,
    //   "status, type, commission, commissionType "
    // );

    if (!status) {
      return res
        .status(400)
        .json({ success: false, message: "status is required" });
    }

    // ✅ validate status matches enum
    const validStatuses = ["PENDING", "APPROVED", "REJECTED", "BLOCKED"];
    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });
    }

    // Reject/Block should not require commission; Accept still does for SPECIAL/COMPANY
    const isNegativeStatus = status === "REJECTED" || status === "BLOCKED";
    if (!isNegativeStatus && type !== "INDIVIDUAL" && commission === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Please Add Commission" });
    }

    const user = await AffUser.findById(userId);

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (!user.affType) {
      user.affType = {};
    }

    const previousStatus = user.status;
    user.status = status;
    user.affType.type = type;
    user.affType.tdsType = tdsType;
    user.affType.isTdsEnabled =
      typeof isTdsEnabled === "boolean" ? isTdsEnabled : true;

    // ✅ Only update commission if > 0
    if (typeof commission === "number" && commission > 0) {
      user.affType.commission = commission;
    }

    // Always update commissionType
    if (commissionType) {
      user.affType.commissionType = commissionType;
    }

    await user.save();

    const adminId = req.admin?._id;
    if (adminId && previousStatus !== status) {
      const who = user.fullName || user.userName || user.email || "Affiliate";
      const statusLabel =
        status === "APPROVED"
          ? "approved and activated"
          : status === "REJECTED"
            ? "rejected"
            : status === "BLOCKED"
              ? "blocked"
              : `updated to ${status}`;

      await notifyAdmin({
        adminId,
        action: UserActionEnum.USER_STATUS_CHANGE,
        category: UserCategoryEnum.ADMIN,
        message: `${who} has been ${statusLabel}`,
        metadata: {
          userId: user._id,
          previousStatus,
          status,
        },
      });
    }

    return res.json({
      success: true,
      message: `User status updated to ${status}`,
      data: user,
    });
  } catch (error) {
    console.error("Error updating status:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// Update user by ID with dynamic body fields
export const genericUpdateAffUser = async (req, res,next) => {
  try {
    const { userId } = req.params;
    const updateData = req.body;

    console.log(userId,'userId');
    console.log(updateData,'updateData');

    const updatedUser = await updateAffUser(userId, updateData);

    return res.status(201).json({
      success: true,
      message: "User updated successfully",
      data: updatedUser,
    });
  } catch (err) {
    // console.error("Error in generic update:", err);
    next(err)
    // return res.status(500).json({
    //   success: false,
    //   message: "Internal server error while updating user",
    //   error: err.message,
    // });
  }
};

// Actual DB update helper
export const updateAffUser = async (userId, updateData) => {
  const user = await AffUser.findById(userId);
  const validErrorStatuses = ["REJECTED", "BLOCKED"];

  if (validErrorStatuses.includes(user.status)) {
    return res
      .status(400)
      .json({ success: false, message: `This Account Is ${user.status}` });
  }
  const updatedUser = await AffUser.findByIdAndUpdate(
    userId,
    { $set: updateData },
    { new: true, runValidators: true }
  );

  if (!updatedUser) {
    throw new Error("User not found");
  }

  return updatedUser;
};
