import mongoose from "mongoose";

const commissionProductDetailSchema = new mongoose.Schema(
  {
    productId: { type: String, required: true },
    productAmount: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      enum: ["ACTIVE", "CANCELLED"],
      default: "ACTIVE",
    },
  },
  { _id: false }
);

const commissionRecordSchema = new mongoose.Schema({
  orderId: { type: String, required: true },
  adminId:{ type: mongoose.Schema.Types.ObjectId, ref: "User" },
  userId:{ type: mongoose.Schema.Types.ObjectId, ref: "User" },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: "Campaign" },
  commissionAmount: { type: Number, required: true },
  purchaseAmount: { type: Number, required: true },
  tdsAmount: { type: Number, default: 0 }, // TDS per transaction
  finalCommission: { type: Number, default: 0 }, // after TDS deduction
  blockedAmount: { type: Number, default: 0 }, // after TDS deduction
  commissionPercent: { type: Number, default: 0 },
  productDetails: { type: [commissionProductDetailSchema], default: [] },
  status: {
    type: String,
    enum: ["PENDING","HOLD", "PAID", "CANCELLED"],
    default: "PENDING",
  },
  createdAt: { type: Date, default: Date.now },
});

commissionRecordSchema.index({ orderId: 1 }, { unique: true });

export const Commissions =
  mongoose.models.Commissions ||
  mongoose.model("Commissions", commissionRecordSchema);
