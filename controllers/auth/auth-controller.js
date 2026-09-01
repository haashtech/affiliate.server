import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import AffUser from "../../models/aff-user.js";
import { Platform } from "../../models/platformSchema.js";
import { ExtractDomainParts } from "../../helper/domain-existence.js";

import Domains from "../../models/domainSchema.js";
import { getCookieDomain } from "../../helper/req-call.js";
import { NotFoundError, UnauthorizedError } from "../../utils/errors.js";
import { NpmPackage } from "../../models/npmSchema.js";
import { generateApiKey } from "../../utils/generateApiKey.js";

const JWT_SECRET_ADMIN = process.env.JWT_SECRET_ADMIN || "supersecretkey";
const JWT_SECRET_USER = process.env.JWT_SECRET_USER || "supersecretkey";
/**
 * REGISTER USER
 */

/**
 * LOGIN USER
 */
export const loginAdmin = async (req, res) => {
  try {
    const { mobile, password, domain } = req.body;

    if (!mobile || !password) {
      return res
        .status(400)
        .json({ message: "Mobile and password are required" });
    }

    // Find user
    const user = await AffUser.findOne({ mobile });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.userType === "USER") {
      return res.status(404).json({ message: "Cant login with this account" });
    }

    // Verify password
    const isMatch = await bcrypt.compare(password, user.password || "");
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid mobile or password" });
    }

    // Generate JWT token
    const payload = {
      adminId: user._id,
      mobile: user.mobile,
      email: user.email,
      domain: domain || user.domain,
    };

    const token = jwt.sign(payload, JWT_SECRET_ADMIN, { expiresIn: "7d" });
    const cookieDomain = getCookieDomain(req);

    // Set cookie
    res.cookie("aff-admin-tkn", token, {
      secure: req.headers.origin?.startsWith("https://"),
      domain: cookieDomain,
      sameSite: "Strict",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    const platform = await Platform.findOne({
      adminId: user._id,
      domain: domain || user.domain,
    });

    return res.status(200).json({
      message: "Login successful",
      token,
      user,
      platform,
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message });
  }
};

export const loginUser = async (req, res, next) => {
  try {
    const { mobile, password } = req.body;
    const cookieDomain = getCookieDomain(req);

    // Find user
    const user = await AffUser.findOne({ mobile });
    if (!user) {
      // return res.status(404).json({ success: false, message: "User not found" });
      throw new NotFoundError("User not found");
    }

    if (user.status === "BLOCKED") {
      return res
        .status(403)
        .json({ success: false, message: "User has been blocked" });
    }

    // Compare passwords
    const isPassMatch = await bcrypt.compare(password, user.password);
    if (!isPassMatch) {
      throw new UnauthorizedError("Invalid credentials");
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user._id.toString(),
        name: user.userName,
        email: user.email,
        mobile: user.mobile,
        referralId: user.referralId,
      },
      JWT_SECRET_USER,
      { expiresIn: "7d" }
    );

    res.cookie("aff_ses_server", token, {
      httpOnly: true,
      secure: false, // important for IP
      sameSite: "lax", // important for IP
      path: "/",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 🔥 7 days in ms
      // maxAge: 1 * 60 * 1000, // i min
    });

    return res.status(200).json({
      success: true,
      message: "Successfully Logged In",
      token,
    });
  } catch (error) {
    console.error("Login error:", error);
    next(error);
  }
};
