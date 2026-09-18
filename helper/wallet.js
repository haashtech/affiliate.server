import { Wallet } from "../models/walletSchema.js";


/**
 * Add commission to user's wallet for a specific admin
 */
export const addCommissionToWallet = async ({ userId, adminId, commissionRecord }) => {
  const { finalCommission, tdsAmount, _id } = commissionRecord;

  const wallet = await Wallet.findOneAndUpdate(
    { userId, adminId },
    {
      $inc: {
        totalAmount: finalCommission,
        // pendingAmount: finalCommission,
        commissionAmount: finalCommission,
        balanceAmount: finalCommission, // available for withdrawal after payout
      },
      $push: {
        transactions: {
          type: "COMMISSION",
          refId: _id,
          amount: finalCommission,
          tdsAmount,
          status: "PENDING",
        },
      },
    },
    { upsert: true, new: true }
  );

  return wallet;
};

/**
 * Credit a cash tier reward to the affiliate wallet exactly once.
 * Increases available balanceAmount only; does not touch commissionAmount.
 */
export const addCashRewardToWallet = async ({
  userId,
  adminId,
  rewardId,
  amount,
}) => {
  const credit = Number(amount);
  if (!Number.isFinite(credit) || credit <= 0) {
    return null;
  }
  if (!userId || !adminId || !rewardId) {
    return null;
  }

  // Ensure wallet exists first (upsert without array filter quirks)
  await Wallet.findOneAndUpdate(
    { userId, adminId },
    { $setOnInsert: { userId, adminId } },
    { upsert: true }
  );

  // Credit only if this collected-reward id was never recorded
  const wallet = await Wallet.findOneAndUpdate(
    {
      userId,
      adminId,
      transactions: { $not: { $elemMatch: { refId: rewardId } } },
    },
    {
      $inc: {
        balanceAmount: credit,
      },
      $push: {
        transactions: {
          type: "REWARD",
          refId: rewardId,
          amount: credit,
          tdsAmount: 0,
          status: "PAID",
        },
      },
    },
    { new: true }
  );

  return wallet;
};

/**
 * Mark a commission as paid in wallet
 */
export const markCommissionPaid = async ({ userId, adminId, commissionId }) => {
  const wallet = await Wallet.findOne({ userId, adminId });
  if (!wallet) throw new Error("Wallet not found");

  let txn = wallet.transactions.find(t => t.refId.toString() === commissionId.toString());
  if (!txn) throw new Error("Transaction not found");

  if (txn.status !== "PAID") {
    txn.status = "PAID";
    wallet.pendingAmount -= txn.amount;
    wallet.paidAmount += txn.amount;
    await wallet.save();
  }

  return wallet;
};
