import mongoose from "mongoose";
import { UserTypeEnum, statusEnum } from "./enum.js";

const addressSchema = new mongoose.Schema({
  name: { type: String },
  mobile: { type: String },
  city: { type: String },
  buildingNo: { type: String },
  street: { type: String },
  landmark: { type: String },
  state: { type: String },
  country: { type: String },
  pinCode: { type: String },
});

const socialSchema = new mongoose.Schema({
  instagram: { type: String },
  youtube: { type: String },
  facebook: { type: String },
});

const affTypeSchema = new mongoose.Schema({
  type: {
    type: String,
    default: "INDIVIDUAL",
    enum: ["INDIVIDUAL", "SPECIAL", "COMPANY"],
  },
  commission: { type: Number },
  commissionType: {
    type: String,
    default: "ONLY_AFF_PRODUCT",
    enum: ["ALL_PRODUCT", "ONLY_AFF_PRODUCT"],
  },
  tdsType: {
    type: String,
    enum: ["LINKED", "UN_LINKED"],
    default: "LINKED",
  },
  isTdsEnabled: { type: Boolean, default: true },
});

const notificationsSchema = new mongoose.Schema({
  isOn: { type: Boolean, default: true },
  preferences: {
    sms: { type: Boolean, default: true },
    email: { type: Boolean, default: true },
    push: { type: Boolean, default: true },
  },
});

const documentSchema = new mongoose.Schema({
  url: { type: String, required: true },
  type: { type: String, required: true },
  thumbnail: String,
  width: Number,
  height: Number,
  format: String,
  mimetype: String,
  size: Number,
  fileType: String,
});

// ✅ Referral ID generator
let AffUser; // declare first to avoid reference error
const generateReferralId = async () => {
  const year = new Date().getFullYear().toString().slice(-2);
  let referralId;
  let exists = true;

  while (exists) {
    const randomNum = Math.floor(10000 + Math.random() * 90000);
    referralId = `AFF${year}${randomNum}`;
    const existing = await AffUser.findOne({ referralId });
    if (!existing) exists = false;
  }
  return referralId;
};

const userSchema = new mongoose.Schema(
  {
    userName: String,
    // domain: { type: String,  },
    referralCount: { type: Number, default: 0 },
    domain: { type: mongoose.Schema.Types.ObjectId, ref: "domain" },
    platformId: { type: mongoose.Schema.Types.ObjectId, ref: "Platform" },
    campaignAccessKey: [String],
    campaignId: [{ type: mongoose.Schema.Types.ObjectId, ref: "Campaign" }],
    collaborateWith: [
      {
        accountId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        status: {
          type: String,
          enum: ["ACCEPTED", "REJECTED", "PENDING"],
          default: "ACCEPTED", // ✅ just a string, not array
        },
      },
    ],
    workingOn: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    userType: {
      type: String,
      enum: Object.values(UserTypeEnum),
      default: UserTypeEnum.USER,
      required: true,
    },
    affType: affTypeSchema,
    avatar: String,
    fullName: String,
    email: String,
    mobile: String,
    password: { type: String, required: false },
    isVerified: { type: Boolean, default: false },
    preference: String,
    isBlocked: { type: Boolean, default: false },
    policyVerified: { type: Boolean, default: false },

    status: {
      type: String,
      enum: Object.values(statusEnum),
      default: statusEnum.PENDING,
    },
    commissionDetails: {
      totalCommission: { type: Number, default: 0 },
      pendingCommission: { type: Number, default: 0 },
      paidCommission: { type: Number, default: 0 },
      totalTdsCutOff: { type: Number, default: 0 }, // total TDS deducted
      totalCommissionWithTds: { type: Number, default: 0 },
    },

    transactionDetails: {
      withdrawalMethod: {
        type: String,
        enum: ["BANK", "ONLINE"],
        default: "ONLINE",
        required: true,
      },
      method: { type: String, enum: ["BANK", "UPI"] },
      upiId: { type: String, default: "" },
      OnlineBank: {
        accountHolderName: { type: String, default: "" },
        accountNumber: { type: String, default: "" },
        bankName: { type: String, default: "" },
        ifscCode: { type: String, default: "" },
      },
    },
    razorpayAccounts: {
      upi: {
        contactId: String,
        fundAccountId: String,
        isUpdated: Boolean,
      },
      bank: {
        contactId: String,
        fundAccountId: String,
        isUpdated: Boolean,
      },
    },

    registrationVerified: { type: Boolean, default: false },
    campaignStarted: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false },
    referralId: { type: String, unique: true },

    gender: { type: String },
    social: socialSchema,
    notifications: notificationsSchema,
    documents: [documentSchema],
    address: [addressSchema],

    forgotPin: { type: String, default: "" },
    otp: { type: String },
    otpExpiry: { type: Date },

    actions: {
      totalClicks: { type: Number, default: 0 },
      totalOrders: { type: Number, default: 0 },
      totalSales: { type: Number, default: 0 },
    },

    payouts: {
      totalAmount: { type: Number, default: 0 },
      pendingAmount: { type: Number, default: 0 },
      paidAmount: { type: Number, default: 0 },
      cancelledAmount: { type: Number, default: 0 },
      commissionAmount: { type: Number, default: 0 },
      balanceAmount: { type: Number, default: 0 },
    },

    withdrawalDetails: {
      bank: {
        accountHolderName: { type: String, default: "" },
        accountNumber: { type: String, default: "" },
        bankName: { type: String, default: "" },
        ifscCode: { type: String, default: "" },
        upiId: { type: String, default: "" },
      },
      withdrawalPin: { type: String, default: "" },
      havePin: { type: Boolean, default: false },
      haveBank: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

// 🔥 AUTO-SET isUpdated when UPI or BANK details change
userSchema.pre("save", function (next) {
  const user = this;

  if (!user.isModified("transactionDetails")) {
    return next();
  }

  const method = user.transactionDetails.method;

  // UPI changed
  if (method === "UPI") {
    const hasUpiChanged =
      user.isModified("transactionDetails.upiId") ||
      user.isModified("transactionDetails.method");

    if (hasUpiChanged) {
      user.razorpayAccounts.upi.isUpdated = true;
    }
  }

  // BANK changed
  if (method === "BANK") {
    const bank = user.transactionDetails.OnlineBank;

    const hasBankChanged =
      user.isModified("transactionDetails.method") ||
      user.isModified("transactionDetails.OnlineBank.accountHolderName") ||
      user.isModified("transactionDetails.OnlineBank.accountNumber") ||
      user.isModified("transactionDetails.OnlineBank.bankName") ||
      user.isModified("transactionDetails.OnlineBank.ifscCode");

    if (hasBankChanged) {
      user.razorpayAccounts.bank.isUpdated = true;
    }
  }
  next();
});

// ✅ Pre-save hook
userSchema.pre("save", async function (next) {
  if (!this.referralId) {
    this.referralId = await generateReferralId();
  }
  next();
});

AffUser = mongoose.models.User || mongoose.model("User", userSchema);

export default AffUser;
