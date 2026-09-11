import mongoose from "mongoose";

const WithdrawalSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    paymentMethod: { type: String, enum: ["BANK", "ONLINE"], required: true },
    onlineMethod: { 
      method:{type: String, enum: ["BANK", "UPI"]},
      upiId: { type: String, default: "" },
      bank: {
        accountHolderName: { type: String, default: "" },
        accountNumber: { type: String, default: "" },
        bankName: { type: String, default: "" },
        ifscCode: { type: String, default: "" },
      },
     },
    withdrawalAmount: { type: Number, required: true },
    cancelledAmount: { type: Number},
    requestedAmount: { type: Number, required: true }, // user’s requested amount
    transferCharge: { type: Number, default: 0 },
    tdsAmount: { type: Number, required: true, default: 0 },

    // ✅ Razorpay payout tracking
    razorpayContactId: { type: String, default: "" },
    razorpayFundAccountId: { type: String, default: "" },
    razorpayPayoutId: { type: String, default: "" },
  
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "COMPLETED", "CANCELLED", "FAILED","REJECTED","REVERSED"],
      default: "PENDING",
    },
    rejectReason: { type: String },

    // Withdrawal wallet settlement markers (not transactional across Wallet docs)
    accountingApplied: { type: Boolean, default: false },
    accountingKind: {
      type: String,
      enum: ["COMPLETE", "RELEASE", "REVERSE_AFTER_COMPLETE"],
    },
  },
  { timestamps: true }
);

const Withdrawals =
  mongoose.models.Withdrawals ||
  mongoose.model("Withdrawals", WithdrawalSchema);

export default Withdrawals;
