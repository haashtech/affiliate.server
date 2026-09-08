import mongoose from "mongoose";
import { Commissions } from "../../models/commissionSchema.js";
import { encryptData } from "../../utils/cript-data.js";
import { NotFoundError } from "../../utils/errors.js";
import { Transaction } from "../../models/transactionSchema.js";
import { Wallet } from "../../models/walletSchema.js";
import { clean } from "../../helper/json-cleaner.js";

export const userAllCommissionDetails = async (req, res, next) => {
  try {
    const userId = req.user?._id;
    const adminId = req.user?.workingOn;

    if (!userId || !adminId) {
      throw new NotFoundError("Invalid user or admin context");
    }

    const {
      period = "6month",
      sort = "newest",
      campaignId = "all",
    } = req.query;

    /* ---------------- DATE FILTER ---------------- */
    const now = new Date();
    let startDate;

    switch (period) {
      case "all":
        startDate = new Date(0);
        break;
      case "this-month":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case "this-year":
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      case "6month":
      default:
        startDate = new Date(now.getFullYear(), now.getMonth() - 6, 1);
        break;
    }

    const endDate = new Date();
    const sortOrder = sort === "oldest" ? 1 : -1;

    /* ---------------- COMMISSIONS ---------------- */
    const commissionQuery = {
      userId,
      adminId,
      createdAt: { $gte: startDate, $lte: endDate },
    };

    if (campaignId !== "all") {
      commissionQuery.campaignId = new mongoose.Types.ObjectId(campaignId);
    }

    const commissions = await Commissions.find(commissionQuery)
      .populate("campaignId")
      .sort({ createdAt: sortOrder });

    /* ---------------- WALLET (SINGLE) ---------------- */
    const wallet = await Wallet.findOne({ userId, adminId });

    if (!wallet) {
      return res.status(200).json({
        success: true,
        message: "No wallet found",
        data: encryptData({ commissions, transactions: [] }),
      });
    }

    /* ---------------- TRANSACTIONS ---------------- */
    const transactions = await Transaction.find({
      walletId: wallet._id,
      createdAt: { $gte: startDate, $lte: endDate },
    })
      .populate("walletId")
      .sort({ createdAt: sortOrder });

    /* ---------------- RESPONSE ---------------- */
    const safePayload = clean({
      wallet,
      commissions,
      transactions,
    });

    const encryptedData = encryptData(safePayload);

    return res.status(200).json({
      success: true,
      message: "Commission & transactions fetched",
      data: encryptedData,
    });
  } catch (error) {
    next(error);
  }
};

export const userCommissionSummary = async (req, res, next) => {
  try {
    const userId = req.user?._id;
    const adminId = req.user?.workingOn;

    if (!userId || !adminId) {
      throw new NotFoundError("Invalid user or admin context");
    }

    const commissions = await Commissions.find({
      userId,
      adminId,
      status: { $nin: ["CANCELLED"] },
    }).select("commissionAmount tdsAmount finalCommission status");

    const totals = commissions.reduce(
      (acc, row) => {
        const gross = Number(row.commissionAmount) || 0;
        const tds = Number(row.tdsAmount) || 0;
        const net = Number(row.finalCommission) || 0;

        acc.gross += gross;
        acc.tds += tds;
        acc.netEarned += net;

        if (row.status === "PENDING" || row.status === "HOLD") {
          acc.pendingRelease += net;
        } else if (row.status === "PAID") {
          acc.releasedToWallet += net;
        }

        return acc;
      },
      {
        gross: 0,
        tds: 0,
        netEarned: 0,
        pendingRelease: 0,
        releasedToWallet: 0,
      }
    );

    const wallet = await Wallet.findOne({ userId, adminId }).select(
      "balanceAmount pendingAmount"
    );

    const summary = clean({
      gross: totals.gross,
      tds: totals.tds,
      netEarned: totals.netEarned,
      pendingRelease: totals.pendingRelease,
      releasedToWallet: totals.releasedToWallet,
      availableBalance: Number(wallet?.balanceAmount) || 0,
      withdrawalProcessing: Number(wallet?.pendingAmount) || 0,
    });

    return res.status(200).json({
      success: true,
      message: "Commission summary fetched",
      data: encryptData(summary),
    });
  } catch (error) {
    next(error);
  }
};


// export const userAllCommissionDetails = async (req, res, next) => {
//   try {
//     const userId = req.user._id;
//     const adminId = req.user.workingOn;

//     if (!userId) {
//       throw new NotFoundError("No user found ");
//     }
//     console.log(req.query);

//     // 1. find commission with the user and admin
//     const commission = await Commissions.find({
//       userId,
//       adminId,
//     }).populate("campaignId");

//     if (!commission) {
//       throw new NotFoundError("No commission found for this req");
//     }

//     const encryptedData = encryptData(commission)

//     return res.status(200).json({
//       message: "Commission found",
//       data: commission,
//       success: true,
//     });
//   } catch (error) {
//     // console.log(error);
//     next(error);
//   }
// };
