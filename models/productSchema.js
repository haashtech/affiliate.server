// import mongoose from "mongoose";

// const productSchema = new mongoose.Schema(
//   {
//     // clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
//     domain: { type: String, required: true },
//     productId: { type: String, required: true }, // original product ID from client
//     productData: { type: mongoose.Schema.Types.Mixed }, // dynamic data, can store any JSON
//     commission: { type: Number, default: 0 },
//     // affiliate: {
//     //   commission: { type: Number, default: 0 },
//     //   commissionType: { type: String, enum: ["FIXED", "PERCENT"], default: "PERCENT" },
//     //   isActive: { type: Boolean, default: true },
//     // },
//     category: String,
//     status: { type: String,enum:["ACTIVE","PAUSED"], default: "ACTIVE" },
//   },
//   { timestamps: true }
// );

// export const Product = mongoose.models.Product || mongoose.model("Product", productSchema);
import mongoose from "mongoose";

const variationSchema = new mongoose.Schema({
  variationName: String,
  photos: [String],
  sizeArray: [
    {
      size: String,
      stock: Number,
      outOfStock: Boolean,
    },
  ],
});

const productSchema = new mongoose.Schema(
  {
    domain: { type: String, required: true },
    productId: { type: String, required: true },
    productName: { type: String, required: true },
    mrp: { type: Number, required: true },
    category: { type: String },
    variations: [variationSchema], // array of variants
    commission: { type: Number, default: 0 }, // used for frontend editing
    isActive: { type: Boolean, default: true },
    status: { type: String, enum: ["ACTIVE", "PAUSED"], default: "ACTIVE" },
  },
  { timestamps: true }
);

productSchema.index({ productId: 1, domain: 1 }, { unique: true });

export const Product =
  mongoose.models.Product || mongoose.model("Product", productSchema);
