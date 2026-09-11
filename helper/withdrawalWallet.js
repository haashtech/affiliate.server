import Withdrawals from "../models/withdrawalSchema.js";
import { Wallet } from "../models/walletSchema.js";
import { Transaction } from "../models/transactionSchema.js";
import { DailyActionUpdater } from "../utils/recordAction.js";

const OPEN_STATUSES = ["PENDING", "PROCESSING"];

const idFilterFromArgs = ({ withdrawalId, razorpayPayoutId }) => {
  if (withdrawalId) return { _id: withdrawalId };
  if (razorpayPayoutId) return { razorpayPayoutId };
  throw new Error("withdrawalId or razorpayPayoutId is required");
};

const amountsOf = (withdrawal) => ({
  requestedAmount: Number(withdrawal.requestedAmount) || 0,
  withdrawalAmount: Number(withdrawal.withdrawalAmount) || 0,
});

const classifyMiss = async (filter, { settledStatus, settledKind }) => {
  const existing = await Withdrawals.findOne(filter);
  if (!existing) return { code: "notFound" };

  if (
    existing.accountingApplied &&
    existing.status === settledStatus &&
    existing.accountingKind === settledKind
  ) {
    return { code: "alreadySettled", withdrawal: existing };
  }

  // Same terminal accounting already applied under a related status (e.g. FAILED→REVERSED)
  if (
    existing.accountingApplied &&
    existing.accountingKind === settledKind &&
    settledKind === "RELEASE" &&
    ["FAILED", "REVERSED", "REJECTED", "CANCELLED"].includes(existing.status)
  ) {
    return { code: "alreadySettled", withdrawal: existing };
  }

  if (
    existing.accountingApplied &&
    existing.accountingKind === "REVERSE_AFTER_COMPLETE" &&
    existing.status === "REVERSED"
  ) {
    return { code: "alreadySettled", withdrawal: existing };
  }

  return {
    code: "invalidStatus",
    withdrawal: existing,
    currentStatus: existing.status,
  };
};

async function applyWalletComplete(withdrawal) {
  const { withdrawalAmount } = amountsOf(withdrawal);
  const wallet = await Wallet.findOneAndUpdate(
    { userId: withdrawal.user, adminId: withdrawal.adminId },
    [
      {
        $set: {
          paidAmount: { $add: ["$paidAmount", withdrawalAmount] },
          pendingAmount: {
            $max: [0, { $subtract: ["$pendingAmount", withdrawalAmount] }],
          },
        },
      },
    ],
    { new: true }
  );
  if (!wallet) throw new Error("Wallet not found for completion");
  return wallet;
}

async function applyWalletRelease(withdrawal) {
  const { requestedAmount, withdrawalAmount } = amountsOf(withdrawal);
  const wallet = await Wallet.findOneAndUpdate(
    { userId: withdrawal.user, adminId: withdrawal.adminId },
    [
      {
        $set: {
          balanceAmount: { $add: ["$balanceAmount", requestedAmount] },
          pendingAmount: {
            $max: [0, { $subtract: ["$pendingAmount", withdrawalAmount] }],
          },
        },
      },
    ],
    { new: true }
  );
  if (!wallet) throw new Error("Wallet not found for release");
  return wallet;
}

async function applyWalletUndoComplete(withdrawal) {
  const { requestedAmount, withdrawalAmount } = amountsOf(withdrawal);
  const wallet = await Wallet.findOneAndUpdate(
    { userId: withdrawal.user, adminId: withdrawal.adminId },
    [
      {
        $set: {
          balanceAmount: { $add: ["$balanceAmount", requestedAmount] },
          paidAmount: {
            $max: [0, { $subtract: ["$paidAmount", withdrawalAmount] }],
          },
        },
      },
    ],
    { new: true }
  );
  if (!wallet) throw new Error("Wallet not found for reverse-after-complete");
  return wallet;
}

async function finishCompleteSideEffects(withdrawal, wallet, paymentMethod) {
  const { withdrawalAmount } = amountsOf(withdrawal);
  const existing = await Transaction.findOne({
    refId: withdrawal._id,
    type: "PAY",
    status: "PAID",
  });
  if (existing) return; // already recorded — skip txn + daily action on retry

  await Transaction.create({
    walletId: wallet._id,
    type: "PAY",
    refId: withdrawal._id,
    amount: withdrawalAmount,
    tdsAmount: withdrawal.tdsAmount || 0,
    method:
      paymentMethod === "ONLINE" || paymentMethod === "RAZORPAY"
        ? "RAZORPAY"
        : "BANK",
    status: "PAID",
    message: `Withdrawal of amount ₹${withdrawalAmount} completed.`,
  });

  await new DailyActionUpdater(wallet.userId, wallet.adminId)
    .increment("earnings", withdrawalAmount)
    .apply();
}

/**
 * Claim open withdrawal → COMPLETED, then adjust wallet by withdrawalAmount.
 * Not cross-document atomic; recoverable via accountingApplied / partial path.
 */
export async function completeWithdrawal({
  withdrawalId,
  razorpayPayoutId,
  paymentReference,
  paymentMethod,
} = {}) {
  const filter = idFilterFromArgs({ withdrawalId, razorpayPayoutId });

  // Recover: status already COMPLETED but wallet not applied
  const partial = await Withdrawals.findOne({
    ...filter,
    status: "COMPLETED",
    accountingKind: "COMPLETE",
    accountingApplied: { $ne: true },
  });
  if (partial) {
    try {
      const wallet = await applyWalletComplete(partial);
      await finishCompleteSideEffects(
        partial,
        wallet,
        paymentMethod || partial.paymentMethod
      );
      const withdrawal = await Withdrawals.findByIdAndUpdate(
        partial._id,
        {
          $set: {
            accountingApplied: true,
            ...(paymentReference ? { razorpayPayoutId: paymentReference } : {}),
          },
        },
        { new: true }
      );
      return { code: "ok", withdrawal, recovered: true };
    } catch (error) {
      console.error("completeWithdrawal walletUpdateFailed (partial):", error);
      return { code: "walletUpdateFailed", withdrawal: partial, error };
    }
  }

  const claimed = await Withdrawals.findOneAndUpdate(
    {
      ...filter,
      status: { $in: OPEN_STATUSES },
      accountingApplied: { $ne: true },
    },
    {
      $set: {
        status: "COMPLETED",
        accountingKind: "COMPLETE",
        ...(paymentReference ? { razorpayPayoutId: paymentReference } : {}),
      },
    },
    { new: true }
  );

  if (!claimed) {
    return classifyMiss(filter, {
      settledStatus: "COMPLETED",
      settledKind: "COMPLETE",
    });
  }

  try {
    const wallet = await applyWalletComplete(claimed);
    await finishCompleteSideEffects(
      claimed,
      wallet,
      paymentMethod || claimed.paymentMethod
    );
    const withdrawal = await Withdrawals.findByIdAndUpdate(
      claimed._id,
      { $set: { accountingApplied: true } },
      { new: true }
    );
    return { code: "ok", withdrawal };
  } catch (error) {
    console.error("completeWithdrawal walletUpdateFailed:", error);
    return { code: "walletUpdateFailed", withdrawal: claimed, error };
  }
}

/**
 * Admin REJECTED / CANCELLED — release lock; preserve requestedAmount & withdrawalAmount.
 */
export async function rejectWithdrawal({
  withdrawalId,
  reason,
  terminalStatus = "REJECTED",
} = {}) {
  if (!["REJECTED", "CANCELLED"].includes(terminalStatus)) {
    throw new Error("rejectWithdrawal terminalStatus must be REJECTED or CANCELLED");
  }

  const filter = { _id: withdrawalId };
  const existingForCancel = await Withdrawals.findById(withdrawalId);
  if (!existingForCancel) return { code: "notFound" };

  const cancelledAmount =
    Number(existingForCancel.requestedAmount) ||
    Number(existingForCancel.cancelledAmount) ||
    0;

  // Recover partial RELEASE
  const partial = await Withdrawals.findOne({
    ...filter,
    status: terminalStatus,
    accountingKind: "RELEASE",
    accountingApplied: { $ne: true },
  });
  if (partial) {
    try {
      await applyWalletRelease(partial);
      const withdrawal = await Withdrawals.findByIdAndUpdate(
        partial._id,
        { $set: { accountingApplied: true } },
        { new: true }
      );
      return { code: "ok", withdrawal, recovered: true };
    } catch (error) {
      console.error("rejectWithdrawal walletUpdateFailed (partial):", error);
      return { code: "walletUpdateFailed", withdrawal: partial, error };
    }
  }

  const claimed = await Withdrawals.findOneAndUpdate(
    {
      ...filter,
      status: { $in: OPEN_STATUSES },
      accountingApplied: { $ne: true },
    },
    {
      $set: {
        status: terminalStatus,
        accountingKind: "RELEASE",
        rejectReason:
          terminalStatus === "REJECTED"
            ? reason || "No reason provided"
            : existingForCancel.rejectReason || "",
        cancelledAmount,
        // Preserve requestedAmount and withdrawalAmount for audit / correct math
      },
    },
    { new: true }
  );

  if (!claimed) {
    return classifyMiss(filter, {
      settledStatus: terminalStatus,
      settledKind: "RELEASE",
    });
  }

  try {
    await applyWalletRelease(claimed);
    const withdrawal = await Withdrawals.findByIdAndUpdate(
      claimed._id,
      { $set: { accountingApplied: true } },
      { new: true }
    );
    return { code: "ok", withdrawal };
  } catch (error) {
    console.error("rejectWithdrawal walletUpdateFailed:", error);
    return { code: "walletUpdateFailed", withdrawal: claimed, error };
  }
}

/**
 * Razorpay payout.failed — release open lock once. Not the same as admin reject.
 */
export async function failPayout({ razorpayPayoutId } = {}) {
  const filter = idFilterFromArgs({ razorpayPayoutId });

  const partial = await Withdrawals.findOne({
    ...filter,
    status: "FAILED",
    accountingKind: "RELEASE",
    accountingApplied: { $ne: true },
  });
  if (partial) {
    try {
      await applyWalletRelease(partial);
      const withdrawal = await Withdrawals.findByIdAndUpdate(
        partial._id,
        { $set: { accountingApplied: true } },
        { new: true }
      );
      return { code: "ok", withdrawal, recovered: true };
    } catch (error) {
      console.error("failPayout walletUpdateFailed (partial):", error);
      return { code: "walletUpdateFailed", withdrawal: partial, error };
    }
  }

  const claimed = await Withdrawals.findOneAndUpdate(
    {
      ...filter,
      status: { $in: OPEN_STATUSES },
      accountingApplied: { $ne: true },
    },
    {
      $set: {
        status: "FAILED",
        accountingKind: "RELEASE",
      },
    },
    { new: true }
  );

  if (!claimed) {
    return classifyMiss(filter, {
      settledStatus: "FAILED",
      settledKind: "RELEASE",
    });
  }

  try {
    await applyWalletRelease(claimed);
    const withdrawal = await Withdrawals.findByIdAndUpdate(
      claimed._id,
      { $set: { accountingApplied: true } },
      { new: true }
    );
    return { code: "ok", withdrawal };
  } catch (error) {
    console.error("failPayout walletUpdateFailed:", error);
    return { code: "walletUpdateFailed", withdrawal: claimed, error };
  }
}

/**
 * Razorpay payout.reversed — separate from fail/reject.
 * - Still open: release lock once
 * - Already FAILED (RELEASE applied): status-only → REVERSED
 * - Already COMPLETED: undo paid + restore balance
 */
export async function reversePayout({ razorpayPayoutId } = {}) {
  const filter = idFilterFromArgs({ razorpayPayoutId });

  // Already fully reversed
  const settledReverse = await Withdrawals.findOne({
    ...filter,
    status: "REVERSED",
    accountingApplied: true,
    accountingKind: { $in: ["RELEASE", "REVERSE_AFTER_COMPLETE"] },
  });
  if (settledReverse) {
    return { code: "alreadySettled", withdrawal: settledReverse };
  }

  // FAILED already released → status only
  const fromFailed = await Withdrawals.findOneAndUpdate(
    {
      ...filter,
      status: "FAILED",
      accountingApplied: true,
      accountingKind: "RELEASE",
    },
    { $set: { status: "REVERSED" } },
    { new: true }
  );
  if (fromFailed) {
    return { code: "ok", withdrawal: fromFailed, walletUnchanged: true };
  }

  // Recover REVERSE_AFTER_COMPLETE partial
  const partialUndo = await Withdrawals.findOne({
    ...filter,
    status: "REVERSED",
    accountingKind: "REVERSE_AFTER_COMPLETE",
    accountingApplied: { $ne: true },
  });
  if (partialUndo) {
    try {
      await applyWalletUndoComplete(partialUndo);
      const withdrawal = await Withdrawals.findByIdAndUpdate(
        partialUndo._id,
        { $set: { accountingApplied: true } },
        { new: true }
      );
      return { code: "ok", withdrawal, recovered: true };
    } catch (error) {
      console.error("reversePayout undo walletUpdateFailed (partial):", error);
      return { code: "walletUpdateFailed", withdrawal: partialUndo, error };
    }
  }

  // COMPLETED → undo completion
  const fromCompleted = await Withdrawals.findOneAndUpdate(
    {
      ...filter,
      status: "COMPLETED",
      accountingApplied: true,
      accountingKind: "COMPLETE",
    },
    {
      $set: {
        status: "REVERSED",
        accountingKind: "REVERSE_AFTER_COMPLETE",
        accountingApplied: false,
      },
    },
    { new: true }
  );
  if (fromCompleted) {
    try {
      await applyWalletUndoComplete(fromCompleted);
      const withdrawal = await Withdrawals.findByIdAndUpdate(
        fromCompleted._id,
        { $set: { accountingApplied: true } },
        { new: true }
      );
      return { code: "ok", withdrawal };
    } catch (error) {
      console.error("reversePayout undo walletUpdateFailed:", error);
      return { code: "walletUpdateFailed", withdrawal: fromCompleted, error };
    }
  }

  // Recover open RELEASE → REVERSED partial
  const partialRelease = await Withdrawals.findOne({
    ...filter,
    status: "REVERSED",
    accountingKind: "RELEASE",
    accountingApplied: { $ne: true },
  });
  if (partialRelease) {
    try {
      await applyWalletRelease(partialRelease);
      const withdrawal = await Withdrawals.findByIdAndUpdate(
        partialRelease._id,
        { $set: { accountingApplied: true } },
        { new: true }
      );
      return { code: "ok", withdrawal, recovered: true };
    } catch (error) {
      console.error("reversePayout release walletUpdateFailed (partial):", error);
      return { code: "walletUpdateFailed", withdrawal: partialRelease, error };
    }
  }

  // Still open → release and mark REVERSED
  const claimed = await Withdrawals.findOneAndUpdate(
    {
      ...filter,
      status: { $in: OPEN_STATUSES },
      accountingApplied: { $ne: true },
    },
    {
      $set: {
        status: "REVERSED",
        accountingKind: "RELEASE",
      },
    },
    { new: true }
  );

  if (!claimed) {
    return classifyMiss(filter, {
      settledStatus: "REVERSED",
      settledKind: "RELEASE",
    });
  }

  try {
    await applyWalletRelease(claimed);
    const withdrawal = await Withdrawals.findByIdAndUpdate(
      claimed._id,
      { $set: { accountingApplied: true } },
      { new: true }
    );
    return { code: "ok", withdrawal };
  } catch (error) {
    console.error("reversePayout release walletUpdateFailed:", error);
    return { code: "walletUpdateFailed", withdrawal: claimed, error };
  }
}
