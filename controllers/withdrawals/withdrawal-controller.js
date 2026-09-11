import Razorpay from "razorpay";
import AffUser from "../../models/aff-user.js";
import { UserActionEnum, UserCategoryEnum } from "../../models/enum.js";
import { Platform } from "../../models/platformSchema.js";
import { Wallet } from "../../models/walletSchema.js";
import Withdrawals from "../../models/withdrawalSchema.js";
import { addHistory } from "../../utils/history.js";
import bcrypt from "bcryptjs";
import { createRazorpayContactAndFund } from "../../lib/RazorpayContactAndFund.js";
import { encryptData } from "../../utils/cript-data.js";
import {
  completeWithdrawal,
  rejectWithdrawal,
} from "../../helper/withdrawalWallet.js";

const razorpayKeyId = process.env.RAZORPAY_KEY_ID;
const razorpayKeySecret = process.env.RAZORPAY_KEY_SECRET;

if (!razorpayKeyId || !razorpayKeySecret) {
  throw new Error("Razorpay configuration is missing");
}

const razorpay = new Razorpay({
  key_id: razorpayKeyId,
  key_secret: razorpayKeySecret,
});


export const getAllAffWithdrawalHistory = async (req, res) => {
  try {
    const filters = {};
    for (const key in req.query) {
      if (req.query[key]) filters[key] = req.query[key];
    }

    const adminId = req.admin;

    // ✅ Validate admin
    const admin = await AffUser.findById(adminId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    // ✅ Find all affiliate users where collaborateWith includes this admin
    const affUsers = await AffUser.find({
      collaborateWith: {
        $elemMatch: {
          accountId: adminId,
          status: "ACCEPTED",
        },
      },
    }).select("_id");

    const affUserIds = affUsers.map((u) => u._id);

    if (affUserIds.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        data: [],
        message: "No affiliate users linked with this admin",
      });
    }

    // ✅ Filter withdrawals that belong to these affiliate users
    const query = {
      ...filters,
      user: { $in: affUserIds },
    };

    const withdrawals = await Withdrawals.find(query)
      .populate(
        "user",
        "fullName email mobile referralId userName withdrawalDetails"
      )
      .sort({ createdAt: -1 });

    const encryptedData = encryptData(withdrawals);

    res.status(200).json({
      success: true,
      count: withdrawals.length,
      data: encryptedData,
    });
  } catch (error) {
    // console.error("Error fetching affiliate withdrawal history:", error);
    res.status(500).json({
      success: false,
      message: "Server error while fetching affiliate withdrawals",
    });
  }
};

// update Aff Withdrawal Status
export const updateAffWithdrawalStatus = async (req, res) => {
  try {
    const { withdrawalId, status, rejectReason } = req.body;

    if (!withdrawalId || !status) {
      return res.status(400).json({
        success: false,
        message: "Withdrawal ID and status are required.",
      });
    }

    const withdrawal = await Withdrawals.findById(withdrawalId).populate(
      "user"
    );
    if (!withdrawal) {
      return res.status(404).json({
        success: false,
        message: "Withdrawal request not found.",
      });
    }

    const user = withdrawal.user;
    const wallet = await Wallet.findOne({
      userId: user._id,
      adminId: withdrawal.adminId,
    });

    if (!wallet) {
      return res
        .status(404)
        .json({ success: false, message: "User wallet not found." });
    }

    // PENDING → PROCESSING: status only (pendingAmount stays locked)
    if (status === "PROCESSING") {
      const updatedWithdrawal = await Withdrawals.findOneAndUpdate(
        {
          _id: withdrawalId,
          status: "PENDING",
        },
        { $set: { status: "PROCESSING", rejectReason: "" } },
        { new: true, runValidators: false }
      ).populate("user");

      if (!updatedWithdrawal) {
        return res.status(400).json({
          success: false,
          message: `Cannot move to PROCESSING from status ${withdrawal.status}.`,
        });
      }

      return res.status(200).json({
        success: true,
        message: `Withdrawal status updated to ${status}`,
        data: updatedWithdrawal,
      });
    }

    if (status === "COMPLETED") {
      const result = await completeWithdrawal({
        withdrawalId,
        paymentMethod: withdrawal.paymentMethod,
      });

      if (result.code === "notFound") {
        return res.status(404).json({
          success: false,
          message: "Withdrawal request not found.",
        });
      }
      if (result.code === "alreadySettled") {
        return res.status(200).json({
          success: true,
          message: "Withdrawal already completed.",
          data: result.withdrawal,
        });
      }
      if (result.code === "invalidStatus") {
        return res.status(400).json({
          success: false,
          message: `Cannot complete withdrawal from status ${result.currentStatus}.`,
        });
      }
      if (result.code === "walletUpdateFailed") {
        return res.status(500).json({
          success: false,
          message: "Withdrawal claimed but wallet update failed. Retry completion.",
          error: result.error?.message,
        });
      }

      const completed = result.withdrawal;
      const withdrawalAmount = Number(completed.withdrawalAmount) || 0;

      await addHistory(
        user._id,
        UserActionEnum.WITHDRAWAL_COMPLETED,
        withdrawalAmount,
        UserCategoryEnum.PAYOUT,
        {
          method: completed.paymentMethod,
          balanceBefore: completed.balanceBefore,
          balanceAfter: completed.balanceAfter,
        }
      );

      const populated = await Withdrawals.findById(completed._id).populate(
        "user"
      );
      return res.status(200).json({
        success: true,
        message: `Withdrawal status updated to ${status}`,
        data: populated,
      });
    }

    if (status === "REJECTED" || status === "CANCELLED") {
      const result = await rejectWithdrawal({
        withdrawalId,
        reason: rejectReason,
        terminalStatus: status,
      });

      if (result.code === "notFound") {
        return res.status(404).json({
          success: false,
          message: "Withdrawal request not found.",
        });
      }
      if (result.code === "alreadySettled") {
        return res.status(200).json({
          success: true,
          message: `Withdrawal already ${status.toLowerCase()}.`,
          data: result.withdrawal,
        });
      }
      if (result.code === "invalidStatus") {
        return res.status(400).json({
          success: false,
          message: `Cannot set ${status} from status ${result.currentStatus}.`,
        });
      }
      if (result.code === "walletUpdateFailed") {
        return res.status(500).json({
          success: false,
          message: "Withdrawal claimed but wallet update failed. Retry.",
          error: result.error?.message,
        });
      }

      const settled = result.withdrawal;
      if (status === "CANCELLED") {
        await addHistory(
          user._id,
          UserActionEnum.WITHDRAWAL_CANCELLED,
          settled.requestedAmount,
          UserCategoryEnum.PAYOUT,
          { method: settled.paymentMethod }
        );
      } else {
        await addHistory(
          user._id,
          UserActionEnum.WITHDRAWAL_REJECT,
          settled.withdrawalAmount,
          UserCategoryEnum.PAYOUT,
          {
            method: settled.paymentMethod,
            reason: rejectReason || "No reason provided",
          }
        );
      }

      const populated = await Withdrawals.findById(settled._id).populate("user");
      return res.status(200).json({
        success: true,
        message: `Withdrawal status updated to ${status}`,
        data: populated,
      });
    }

    return res.status(400).json({
      success: false,
      message: `Unsupported withdrawal status: ${status}`,
    });
  } catch (error) {
    console.error("❌ Error updating withdrawal status:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while updating withdrawal status.",
      error: error.message,
    });
  }
};

export const processWithdrawal = async (req, res, next) => {
  try {
    const adminId = req.params.adminId;
    const userId = req.user._id;
    const { amount, withdrawalPin, method } = req.body;

    if (!adminId || !userId || !amount || !withdrawalPin || !method) {
      return res.status(400).json({
        success: false,
        message: "Required fields missing",
      });
    }

    // 🔹 Fetch user
    const user = await AffUser.findById(userId);
    if (!user)
      return res
        .status(404)
        .json({ success: false, message: "User not found" });

    // 🔹 Validate withdrawal PIN
    const isPinValid = await bcrypt.compare(
      withdrawalPin,
      user.withdrawalDetails.withdrawalPin || ""
    );
    if (!isPinValid)
      return res
        .status(403)
        .json({ success: false, message: "Invalid withdrawal PIN" });

    // 🔹 Fetch wallet
    const wallet = await Wallet.findOne({ userId, adminId });
    if (!wallet)
      return res
        .status(404)
        .json({ success: false, message: "Wallet not found" });

    if (wallet.balanceAmount < amount)
      return res
        .status(400)
        .json({ success: false, message: "Insufficient balance" });

    // 🔹 Fetch platform settings
    const platform = await Platform.findOne({ adminId });
    if (!platform)
      return res
        .status(404)
        .json({ success: false, message: "Platform settings not found" });

    // 🔹 Compute final amount after transfer charges
    let finalAmount = amount;
    if (method === "BANK" && platform.bankTransfer.enabled) {
      if (platform.bankTransfer.amountType === "FIXED")
        finalAmount -= platform.bankTransfer.transferCharge;
      else if (platform.bankTransfer.amountType === "PERCENT")
        finalAmount -=
          (finalAmount * platform.bankTransfer.transferCharge) / 100;
    }

    if (method === "ONLINE" && platform.onlineTransfer.enabled) {
      if (platform.onlineTransfer.amountType === "FIXED")
        finalAmount -= platform.onlineTransfer.transferCharge;
      else if (platform.onlineTransfer.amountType === "PERCENT")
        finalAmount -=
          (finalAmount * platform.onlineTransfer.transferCharge) / 100;
    }

    // -----------------------------------------------------------
    // ✅ 1. VALIDATE Razorpay before touching wallet or creating withdrawal
    // -----------------------------------------------------------
    let contactId;
    let fundAccountId;

    if (method === "ONLINE") {
      try {
        const methodKey =
          user.transactionDetails.method === "UPI" ? "upi" : "bank";

        contactId = user.razorpayAccounts?.[methodKey]?.contactId;
        fundAccountId = user.razorpayAccounts?.[methodKey]?.fundAccountId;
        const isUpdated = user.razorpayAccounts?.[methodKey]?.isUpdated;

        // 🔥 Validate + create new fund/contact if needed
        if (!contactId || !fundAccountId || isUpdated) {
          const result = await createRazorpayContactAndFund(user, methodKey);
          contactId = result.contactId;
          fundAccountId = result.fundAccountId;

          user.razorpayAccounts[methodKey] = {
            contactId,
            fundAccountId,
            isUpdated: false,
          };
          await user.save();
        }
      } catch (err) {
        // console.log(err,'err in razorpay contact/fund creation');

        return res.status(400).json({
          success: false,
          message: err.message || "Invalid UPI/Bank details",
        });
      }
    }

    // -----------------------------------------------------------
    // ✅ 2. NOW SAFE TO UPDATE WALLET BALANCE AFTER VALIDATION PASSED
    // -----------------------------------------------------------
    const balanceBefore = wallet.balanceAmount;
    wallet.balanceAmount -= amount;
    wallet.pendingAmount += finalAmount;
    await wallet.save();

    // -----------------------------------------------------------
    // 🔹 Prepare withdrawal data
    // -----------------------------------------------------------
    const withdrawalData = {
      user: userId,
      adminId,
      paymentMethod: method,
      withdrawalAmount: finalAmount,
      requestedAmount: amount,
      transferCharge: amount - finalAmount,
      balanceBefore,
      balanceAfter: wallet.balanceAmount,
      status: "PENDING",
      tdsAmount: 0,
    };

    // 🔹 Add online payment details now that validation passed
    if (method === "ONLINE") {
      withdrawalData.onlineMethod = {
        method: user.transactionDetails.method,
        upiId: user.transactionDetails.upiId,
        bank: user.transactionDetails.OnlineBank,
      };

      withdrawalData.razorpayContactId = contactId;
      withdrawalData.razorpayFundAccountId = fundAccountId;
    }

    const withdrawal = await Withdrawals.create(withdrawalData);

    // 🔹 Add to history

    await addHistory(
      userId,
      "WITHDRAWAL-REQUEST",
      finalAmount,
      UserCategoryEnum.PAYOUT,
      {
        method,
        balanceBefore,
        balanceAfter: wallet.balanceAmount,
      }
    );

    return res.status(200).json({
      success: true,
      message: `Withdrawal request successful via ${method}`,
      data: {
        withdrawal,
        wallet: {
          balanceAmount: wallet.balanceAmount,
          pendingAmount: wallet.pendingAmount,
          paidAmount: wallet.paidAmount,
        },
      },
    });
  } catch (error) {
    console.error("❌ Error processing withdrawal:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while processing withdrawal",
      error: error.message,
    });
  }
};
