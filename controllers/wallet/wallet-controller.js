import { Commissions } from "../../models/commissionSchema.js";
import { Wallet } from "../../models/walletSchema.js";
import AffUser from "../../models/aff-user.js";
import { Campaign } from "../../models/campaignSchema.js";
import { DailyActionUpdater } from "../../utils/recordAction.js";
import {
  BadRequestError,
  MissingFieldError,
  NotFoundError,
} from "../../utils/errors.js";

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function floorZero(value) {
  return Math.max(0, roundMoney(value));
}

function resolveProductId(req) {
  const fromBody = req.body?.productId;
  const fromQuery = req.query?.productId;
  return String(fromBody || fromQuery || "").trim();
}

function getCommissionPercent(commission) {
  const stored = Number(commission.commissionPercent);
  if (stored > 0) return stored;
  const purchase = Number(commission.purchaseAmount) || 0;
  const amount = Number(commission.commissionAmount) || 0;
  return purchase > 0 ? (amount / purchase) * 100 : 0;
}

function recomputeCommissionAmounts(commission, remainingPurchaseAmount) {
  const originalPurchase = Number(commission.purchaseAmount) || 0;
  const originalCommission = Number(commission.commissionAmount) || 0;
  const originalTds = Number(commission.tdsAmount) || 0;
  const originalFinal = Number(commission.finalCommission) || 0;
  const remaining = roundMoney(remainingPurchaseAmount);

  if (remaining <= 0) {
    return {
      purchaseAmount: 0,
      commissionAmount: 0,
      tdsAmount: 0,
      finalCommission: 0,
      deltaCommission: originalCommission,
      deltaTds: originalTds,
      deltaFinal: originalFinal,
    };
  }

  const percent = getCommissionPercent(commission);
  const newCommission = roundMoney((remaining * percent) / 100);
  const scale = originalPurchase > 0 ? remaining / originalPurchase : 0;
  const newTds = roundMoney(originalTds * scale);
  const newFinal = roundMoney(Math.max(0, newCommission - newTds));

  return {
    purchaseAmount: remaining,
    commissionAmount: newCommission,
    tdsAmount: newTds,
    finalCommission: newFinal,
    deltaCommission: roundMoney(originalCommission - newCommission),
    deltaTds: roundMoney(originalTds - newTds),
    deltaFinal: roundMoney(originalFinal - newFinal),
  };
}

function remainingActivePurchase(productDetails = []) {
  return (productDetails || [])
    .filter((row) => row.status !== "CANCELLED")
    .reduce((sum, row) => sum + (Number(row.productAmount) || 0), 0);
}

function reverseTotals(details, deltas, pendingField) {
  if (!details) return;
  details[pendingField] = floorZero(
    (details[pendingField] || 0) - deltas.deltaFinal
  );
  details.totalCommission = floorZero(
    (details.totalCommission || 0) - deltas.deltaCommission
  );
  details.totalCommissionWithTds = floorZero(
    (details.totalCommissionWithTds || 0) - deltas.deltaFinal
  );
  details.totalTdsCutOff = floorZero(
    (details.totalTdsCutOff || 0) - deltas.deltaTds
  );
}

async function applyCommissionReduction(commission, recomputed) {
  const originalStatus = commission.status;
  const fullyCancelled =
    remainingActivePurchase(commission.productDetails) <= 0 ||
    recomputed.purchaseAmount <= 0;

  commission.purchaseAmount = recomputed.purchaseAmount;
  commission.commissionAmount = recomputed.commissionAmount;
  commission.tdsAmount = recomputed.tdsAmount;
  commission.finalCommission = recomputed.finalCommission;
  if (fullyCancelled) {
    commission.status = "CANCELLED";
  }

  const user = commission.userId
    ? await AffUser.findById(commission.userId)
    : null;
  const campaign = commission.campaignId
    ? await Campaign.findById(commission.campaignId)
    : null;

  if (originalStatus === "PAID") {
    reverseTotals(user?.commissionDetails, recomputed, "paidCommission");
    reverseTotals(campaign?.commissionDetails, recomputed, "paidCommission");
    if (user?.payouts) {
      user.payouts.balanceAmount = floorZero(
        (user.payouts.balanceAmount || 0) - recomputed.deltaFinal
      );
      user.payouts.cancelledAmount = roundMoney(
        (user.payouts.cancelledAmount || 0) + recomputed.deltaFinal
      );
      user.payouts.commissionAmount = floorZero(
        (user.payouts.commissionAmount || 0) - recomputed.deltaFinal
      );
    }

    if (recomputed.deltaFinal > 0) {
      const wallet =
        (commission.adminId
          ? await Wallet.findOne({
              userId: commission.userId,
              adminId: commission.adminId,
            })
          : null) || (await Wallet.findOne({ userId: commission.userId }));

      if (wallet) {
        wallet.balanceAmount = floorZero(
          (wallet.balanceAmount || 0) - recomputed.deltaFinal
        );
        wallet.cancelledAmount = roundMoney(
          (wallet.cancelledAmount || 0) + recomputed.deltaFinal
        );
        wallet.transactions.push({
          type: "COMMISSION",
          refId: commission._id,
          amount: -recomputed.deltaFinal,
          status: "CANCELLED",
          createdAt: new Date(),
        });
        await wallet.save();
      }
    }
  } else if (originalStatus === "PENDING" || originalStatus === "HOLD") {
    reverseTotals(user?.commissionDetails, recomputed, "pendingCommission");
    reverseTotals(campaign?.commissionDetails, recomputed, "pendingCommission");
  }

  if (fullyCancelled && originalStatus !== "CANCELLED") {
    if (campaign) {
      campaign.ordersCount = Math.max(0, (campaign.ordersCount || 0) - 1);
    }
    if (user?.actions) {
      user.actions.totalOrders = Math.max(0, (user.actions.totalOrders || 0) - 1);
    }
    if (user) {
      const orderDate = commission.createdAt
        ? new Date(commission.createdAt).toISOString().slice(0, 10)
        : undefined;
      await new DailyActionUpdater(
        user._id,
        commission.adminId || user.workingOn,
        orderDate
      )
        .decrement("orders")
        .apply();
    }
  }

  await commission.save();
  if (user) await user.save();
  if (campaign) await campaign.save();
}

/**
 * Get all wallets
 */
export const getAllWallets = async (req, res) => {
  try {
    const wallets = await Wallet.find()
      .populate("userId", "userName email")
      .populate("adminId", "userName email");
    return res.status(200).json(wallets);
  } catch (err) {
    console.error("❌ Error fetching all wallets:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

/**
 * Get all wallets for a specific admin
 */
export const getAdminWallets = async (req, res) => {
  try {
    const { adminId } = req.params;

    if (!adminId) {
      return res.status(400).json({ message: "Admin ID is required" });
    }

    const wallets = await Wallet.find({ adminId })
      .populate("userId", "userName email")
      .populate("adminId", "userName email");
    return res.status(200).json(wallets);
  } catch (err) {
    console.error("❌ Error fetching admin wallets:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

/**
 * Get wallet for a specific user + admin
 */
export const getUserAdminWallet = async (req, res) => {
  try {
    const { userId, adminId } = req.params;
    if (!userId || !adminId) {
      return res
        .status(400)
        .json({ message: "User ID and Admin ID are required" });
    }

    const wallet = await Wallet.findOne({ userId, adminId })
      .populate("userId", "userName email")
      .populate("adminId", "userName email");

    if (!wallet) return res.status(404).json({ message: "Wallet not found" });
    return res.status(200).json({
      data: wallet,
      message: "User wallet fetched successfully",
    });
  } catch (err) {
    console.error("❌ Error fetching user wallet:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

// ----------------------------------------------------------------
// 🧩 Step : cancel commission amount when order cancel / return
// ----------------------------------------------------------------

export const cancelWalletCommissionAmountFromAff = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const productId = resolveProductId(req);

    if (!orderId) {
      throw new MissingFieldError("Order Id is missing");
    }
    if (!productId) {
      throw new MissingFieldError("Product Id is missing");
    }

    const commission = await Commissions.findOne({ orderId });

    if (!commission) {
      return res.status(200).json({
        success: true,
        skipped: true,
        message: "No commission found for this order",
      });
    }

    if (commission.status === "CANCELLED") {
      return res.status(200).json({
        success: true,
        skipped: true,
        message: "Commission already cancelled",
      });
    }

    const productDetails = Array.isArray(commission.productDetails)
      ? commission.productDetails
      : [];

    if (productDetails.length > 0) {
      const row = productDetails.find(
        (item) => String(item.productId) === String(productId)
      );

      if (!row) {
        return res.status(200).json({
          success: true,
          skipped: true,
          message: "Product was not commission-eligible for this order",
        });
      }

      if (row.status === "CANCELLED") {
        return res.status(200).json({
          success: true,
          skipped: true,
          message: "Product commission already cancelled",
        });
      }

      row.status = "CANCELLED";
      commission.markModified("productDetails");
      const recomputed = recomputeCommissionAmounts(
        commission,
        remainingActivePurchase(productDetails)
      );
      await applyCommissionReduction(commission, recomputed);

      return res.status(200).json({
        success: true,
        message: recomputed.purchaseAmount <= 0
          ? "Commission cancelled for this product; no remaining products"
          : "Commission reduced for cancelled product",
        data: {
          orderId,
          productId,
          status: commission.status,
          purchaseAmount: commission.purchaseAmount,
          finalCommission: commission.finalCommission,
        },
      });
    }

    const recomputed = recomputeCommissionAmounts(commission, 0);
    await applyCommissionReduction(commission, recomputed);

    return res.status(200).json({
      success: true,
      message: "Legacy commission cancelled for this order",
      data: {
        orderId,
        productId,
        status: commission.status,
        purchaseAmount: commission.purchaseAmount,
        finalCommission: commission.finalCommission,
      },
    });
  } catch (error) {
    next(error);
  }
};

// ----------------------------------------------------------------
// 🧩 Step : recharge wallet
// ----------------------------------------------------------------

export const rechargeUserWallet = async (req, res, next) => {
  try {
    const adminId = req.params.adminId;
    const userId = req.params.userId;

    if (
      String(req.user._id) !== String(userId) ||
      String(req.user.workingOn) !== String(adminId)
    ) {
      return res.status(403).json({
        success: false,
        message: "Not authorized",
      });
    }

    const { amount, type } = req.body;

    if (!amount || amount <= 0) {
      throw new BadRequestError("Recharge amount must be greater than 0");
    }

    const wallet = await Wallet.findOne({ userId, adminId });

    if (!wallet) {
      throw new NotFoundError("Wallet not found");
    }

    // ✅ Update recharge details
    wallet.recharge = {
      rechargeAmount: amount,
      type: type || "LOCAL",
      date: new Date().toISOString(),
    };

    // ✅ Add to balanceAmount
    wallet.balanceAmount += Number(amount);

    // ✅ Optionally add a transaction record
    wallet.transactions.push({
      type: "RECHARGE", // or "RECHARGE" if you add it to enum
      amount,
      status: "PAID",
      createdAt: new Date(),
    });

    await wallet.save();

    return res.status(200).json({
      success: true,
      message: "Wallet recharged successfully",
      wallet,
    });
  } catch (err) {
    // console.error("💥 rechargeUserWallet error:", err);
    next(err);
  }
};
