import axios from "axios";
import Withdrawals from "../../models/withdrawalSchema.js";
import AffUser from "../../models/aff-user.js";

/**
 * Admin triggers payout to send user's withdrawal
 */
export const payWithdrawalToUser = async (req, res) => {
  try {
    const { withdrawalId } = req.body;
    if (!withdrawalId)
      return res.status(400).json({ success: false, message: "Withdrawal ID required" });

    // 1️⃣ Fetch withdrawal and user
    const withdrawal = await Withdrawals.findById(withdrawalId).populate("user");
    if (!withdrawal)
      return res.status(404).json({ success: false, message: "Withdrawal not found" });

    if (withdrawal.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: `Payout can only be initiated for PENDING withdrawals (current: ${withdrawal.status}).`,
      });
    }

    const user = await AffUser.findById(withdrawal.user);
    if (!user)
      return res.status(404).json({ success: false, message: "User not found" });

    const amount = Math.round(withdrawal.withdrawalAmount * 100); // Razorpay uses paise
    const isUPI = withdrawal.onlineMethod.method === "UPI";

    // 2️⃣ Get saved Razorpay IDs from withdrawal (already created earlier)
    const contactId = withdrawal.razorpayContactId;
    const fundAccountId = withdrawal.razorpayFundAccountId;

    if (!contactId || !fundAccountId) {
      return res.status(400).json({
        success: false,
        message: "Missing Razorpay contact or fund account in withdrawal record.",
      });
    }

    // 3️⃣ Configure Axios Auth
    const key_id = process.env.RAZORPAY_KEY_ID;
    const key_secret = process.env.RAZORPAY_KEY_SECRET;
    if (!key_id || !key_secret) {
      return res.status(500).json({
        success: false,
        message: "Payment provider is not configured",
      });
    }
    const auth = { username: key_id, password: key_secret };

    // 4️⃣ Prepare payout payload
    const payoutPayload = {
      account_number: process.env.RAZORPAY_ACCOUNT_NUMBER,
      fund_account_id: fundAccountId,
      amount,
      currency: "INR",
      mode: isUPI ? "UPI" : "NEFT",
      purpose: "payout",
      reference_id: withdrawal._id.toString(),
      queue_if_low_balance: true,
      narration: `Withdrawal for ${user.userName || user.fullName}`,
      notes: {
        withdrawalId: withdrawal._id.toString(),
        userId: user._id.toString(),
      },
    };

    // 5️⃣ Send payout request
    const payoutRes = await axios.post(
      "https://api.razorpay.com/v1/payouts",
      payoutPayload,
      { auth }
    );

    const payout = payoutRes.data;

    // 6️⃣ Update withdrawal → PROCESSING; do NOT touch pendingAmount
    const updated = await Withdrawals.findOneAndUpdate(
      { _id: withdrawalId, status: "PENDING" },
      {
        $set: {
          razorpayPayoutId: payout.id,
          status: "PROCESSING",
        },
      },
      { new: true }
    );

    if (!updated) {
      return res.status(400).json({
        success: false,
        message: "Withdrawal is no longer PENDING; payout may have already been started.",
        payout,
      });
    }

    console.log("✅ Payout successful:", payout.id);

    return res.status(200).json({
      success: true,
      message: "Payout initiated successfully",
      payout,
    });
  } catch (error) {
    console.error("❌ Razorpay payout error:", error.response?.data || error.message);
    return res.status(500).json({
      success: false,
      message:
        error.response?.data?.error?.description ||
        error.response?.data?.error?.message ||
        error.message,
    });
  }
};
