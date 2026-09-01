import DailyAction from "../../models/actionSchema.js";
import AffUser from "../../models/aff-user.js";
import { Commissions } from "../../models/commissionSchema.js";
import { UserTypeEnum } from "../../models/enum.js";
import { encryptData } from "../../utils/cript-data.js";
import { NotFoundError } from "../../utils/errors.js";

export const getCurrentUsers = async (req, res, next) => {
  try {
    // console.log(req.admin, "req.admin");
    // console.log(req.user, "req.user");

    const adminId = req.admin?._id;

    // Normal affiliate user case (user making request)
    const userId = req.user?._id;

    // Decide which ID to use
    const checkId = adminId || userId;

    if (!checkId) {
      throw new NotFoundError("User Id Not Found!");
    }

    const user = await AffUser.findById(checkId);

    if (!user) {
      throw new NotFoundError("User Not Found!");
    }

    const encryptedData = encryptData(user);

    return res.status(200).json({
      message: "User Fetching Successfully Completed",
      data: encryptedData,
      success: true,
    });
  } catch (error) {
    next(error);
  }
};

export const getAllAffUsers = async (req, res) => {
  // console.log('getAllAffUsers');

  try {
    // Build filter object from query params
    const filters = {};
    for (const key in req.query) {
      if (req.query[key]) {
        filters[key] = req.query[key];
      }
    }

    // Apply filters if any, otherwise return all
    const users = Object.keys(filters).length
      ? await AffUser.find(filters)
      : await AffUser.find();

    // Encrypt the data before sending
    const encryptedData = encryptData(users);

    res.status(200).json({
      success: true,
      count: users.length,
      data: encryptedData,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching users",
    });
  }
};

export const getAllAffUsersForEachAdmins = async (req, res) => {
  try {
    const adminId = req.admin?._id || req.query.adminId;
    const adminType = req.admin?.userType || req.query.userType;

    const filters = {};

    /* ----------------------------------------
       1️⃣ BUILD FILTERS FROM QUERY
    ---------------------------------------- */
    for (const key in req.query) {
      if (req.query[key] && !["adminId", "userType"].includes(key)) {
        filters[key] = req.query[key];
      }
    }

    const isSingleUserRequest = Boolean(filters._id);

    /* ----------------------------------------
       2️⃣ SINGLE USER FETCH (🔥 IMPORTANT)
    ---------------------------------------- */
    if (isSingleUserRequest) {
      const user = await AffUser.findById(filters._id);

      if (!user) {
        return res.status(200).json({
          success: true,
          count: 0,
          data: encryptData([]),
        });
      }

      // 🔥 Attach summary for single user
      const summary = await DailyAction.aggregate([
        {
          $match: {
            userId: user._id,
            adminId: adminId,
          },
        },
        {
          $group: {
            _id: null,
            totalClicks: { $sum: "$clicks" },
            totalOrders: { $sum: "$orders" },
            totalSales: { $sum: "$sales" },
            totalEarnings: { $sum: "$earnings" },
            totalPaidCommission: { $sum: "$paidCommission" },
            totalActiveCampaigns: { $sum: "$activeCampaigns" },
          },
        },
      ]);

      const pendingCommission = await Commissions.aggregate([
        {
          $match: {
            userId: user._id,
            adminId: adminId,
            status: "PENDING",
          },
        },
        {
          $group: {
            _id: null,
            totalPendingCommission: { $sum: "$finalCommission" },
          },
        },
      ]);

      const result = {
        ...user.toObject(),
        summary: {
          ...(summary[0] || {
            totalClicks: 0,
            totalOrders: 0,
            totalSales: 0,
            totalEarnings: 0,
            totalPaidCommission: 0,
            totalActiveCampaigns: 0,
          }),
          totalPendingCommission:
            pendingCommission[0]?.totalPendingCommission || 0,
        },
      };

      return res.status(200).json({
        success: true,
        count: 1,
        data: encryptData([result]),
      });
    }

    /* ----------------------------------------
       3️⃣ LIST FETCH (NORMAL FLOW)
    ---------------------------------------- */

    // Exclude admin from list
    if (adminId) {
      filters._id = { $ne: adminId };
    }

    // Non super admin sees only collaborators
    if (adminType !== UserTypeEnum.SUPER_ADMIN) {
      filters.collaborateWith = {
        $elemMatch: {
          accountId: adminId,
          status: "ACCEPTED",
        },
      };
    }

    const users = await AffUser.find(filters);

    const usersWithSummary = await Promise.all(
      users.map(async (user) => {
        const summary = await DailyAction.aggregate([
          {
            $match: {
              userId: user._id,
              adminId: adminId,
            },
          },
          {
            $group: {
              _id: null,
              totalClicks: { $sum: "$clicks" },
              totalOrders: { $sum: "$orders" },
              totalSales: { $sum: "$sales" },
              totalEarnings: { $sum: "$earnings" },
              totalPaidCommission: { $sum: "$paidCommission" },
              totalActiveCampaigns: { $sum: "$activeCampaigns" },
            },
          },
        ]);

        const pendingCommission = await Commissions.aggregate([
          {
            $match: {
              userId: user._id,
              adminId: adminId,
              status: "PENDING",
            },
          },
          {
            $group: {
              _id: null,
              totalPendingCommission: { $sum: "$finalCommission" },
            },
          },
        ]);

        return {
          ...user.toObject(),
          summary: {
            ...(summary[0] || {
              totalClicks: 0,
              totalOrders: 0,
              totalSales: 0,
              totalEarnings: 0,
              totalPaidCommission: 0,
              totalActiveCampaigns: 0,
            }),
            totalPendingCommission:
              pendingCommission[0]?.totalPendingCommission || 0,
          },
        };
      })
    );

    res.status(200).json({
      success: true,
      count: users.length,
      data: encryptData(usersWithSummary),
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching users",
    });
  }
};


// =========

export const getAllAdminsAffUsers = async (req, res) => {
  // console.log('getAllAffUsers');

  try {
    // Build filter object from query params

    const admins = await AffUser.find({
      userType: { $in: ["ADMIN", "SUPER_ADMIN"] },
    })
      .select(
        "_id domain avatar userName campaignAccessKey campaignId collaborateWith"
      )
      .populate("domain", "name url");

    return res
      .status(200)
      .json(
        { data: admins, message: "All Admins Fetched Successfully" },
        { status: 200 }
      );
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching users",
    });
  }
};

export const logoutAdmin = async (req, res, next) => {
  try {
    res.clearCookie("aff-admin-tkn", {
      path: "/",
      domain: process.env.COOKIE_DOMAIN,
      secure: process.env.NODE_ENV === "production",
      // httpOnly: true,
      sameSite: "Strict",
    });

    res.clearCookie("connect.sid", {
      path: "/",
      domain: process.env.COOKIE_DOMAIN,
      secure: process.env.NODE_ENV === "production",
      // httpOnly: true,
      sameSite: "Strict",
    });

    res.status(200).json({ message: "Admin logged out successfully" });
  } catch (error) {
    next(error);
  }
};
