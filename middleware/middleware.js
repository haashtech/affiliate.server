import jwt from "jsonwebtoken";
import AffUser from "../models/aff-user.js";
import { statusEnum, UserTypeEnum } from "../models/enum.js";

const JWT_SECRET_USER = process.env.JWT_SECRET_USER;
const JWT_SECRET_ADMIN = process.env.JWT_SECRET_ADMIN;

export const authenticateUser = async (req, res, next) => {
  try {
    const token =
      req.cookies?.aff_ses_server || req.headers.authorization?.split(" ")[1];
      console.log("TOKEN:", token);
    

    if (!token) {
      return res
        .status(401)
        .json({ success: false, message: "Not authorized, no token found." });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET_USER);
      //   console.log(token, "token from authenticateUser middleware");
      // console.log(decoded, "token from authenticateUser middleware");
    } catch (err) {
      console.error("JWT verification failed:", err.message);
      return res
        .status(401)
        .json({ success: false, message: "Invalid or expired token." });
    }

    const user = await AffUser.findById(decoded.id).select("-password");
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "User not found or unauthorized." });
    }

    if (
      user.userType === UserTypeEnum.USER &&
      user.status !== statusEnum.APPROVED
    ) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Your admin account is ${admin.status}.`,
      });
    }

    req.user = user;
    next();
  } catch (error) {
    // console.error("Authentication middleware error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};

// ============== admin middleware ==================
export const authenticateAdmin = async (req, res, next) => {
  try {
    // 1️⃣ Get token from cookie or header
    const token =
      req.cookies?.["aff-admin-tkn"] ||
      req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res
        .status(401)
        .json({ success: false, message: "Not authorized, no token found." });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET_ADMIN);
    } catch (err) {
      // console.error("JWT verification failed:", err.message);
      return res
        .status(401)
        .json({ success: false, message: "Invalid or expired token." });
    }
    //   console.log(token, "token from authenticateUser middleware");
    // console.log(decoded, "token from authenticateAdmin middleware");
    // 2️⃣ Fetch user from DB
    const admin = await AffUser.findById(decoded.adminId).select("-password");
    if (!admin) {
      return res
        .status(401)
        .json({ success: false, message: "User not found." });
    }

    // 3️⃣ Check if admin is admin or super-admin
    if (
      ![UserTypeEnum.ADMIN, UserTypeEnum.SUPER_ADMIN].includes(admin.userType)
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Access denied. Admins only." });
    }

    if (
      admin.userType !== UserTypeEnum.SUPER_ADMIN &&
      admin.status !== statusEnum.APPROVED
    ) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Your admin account is ${admin.status}.`,
      });
    }

    // console.log(admin);

    // 4️⃣ Attach admin to request
    req.admin = admin;
    next();
  } catch (error) {
    console.error("Admin authentication middleware error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
};
