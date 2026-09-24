import mongoose from "mongoose";
import chalk from "chalk";
import { repairAffiliateProductDomains } from "../utils/affiliateProductDomain.js";
// console.log(process.env.MONGODB_UR,'process.env.MONGODB_UR');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URL);
    console.log(chalk.blue("MongoDb connected successfully 👍"));
    try {
      await repairAffiliateProductDomains();
    } catch (error) {
      console.error("Affiliate product domain repair failed:", error);
    }
  } catch (error) {
    console.error(`Can't connect! ${error}`);
  }
};

export default connectDB;
