import mongoose from "mongoose";

const rechargeSchema = new mongoose.Schema({
  rechargeAmount: { type: Number },
  type: { type: String , enum:["LOCAL","PRODUCTION"] },
  date: { type: String },
});

const walletSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    totalAmount: { type: Number, default: 0 },      // lifetime commission earnings (do not bump on payout complete)
    pendingAmount: { type: Number, default: 0 },    // locked net amount in open withdrawals (PENDING/PROCESSING)
    paidAmount: { type: Number, default: 0 },       // successfully paid-out withdrawal nets
    cancelledAmount: { type: Number, default: 0 },  // cancelled commissions
    commissionAmount: { type: Number, default: 0 }, // total commission earned
    balanceAmount: { type: Number, default: 0 },    // available balance for withdrawal
    recharge: rechargeSchema,    // available balance for withdrawal


    transactions: [
      {
        type: { type: String, enum: ["COMMISSION", "WITHDRAWAL", "REFUND", "RECHARGE"], required: true },
        refId: { type: mongoose.Schema.Types.ObjectId }, // ref to Commissions, Withdrawals, etc.
        amount: { type: Number, required: true },
        tdsAmount: { type: Number, default: 0 },
        status: { type: String, enum: ["PENDING", "PAID", "CANCELLED"], default: "PENDING" },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

// ✅ Ensure unique wallet per user-admin pair
walletSchema.index({ userId: 1, adminId: 1 }, { unique: true });

export const Wallet =
  mongoose.models.Wallet || mongoose.model("Wallet", walletSchema);
