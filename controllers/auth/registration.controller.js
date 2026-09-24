import { handleOtpSending } from "../../lib/otp-sender/index.js";
import AffUser from "../../models/aff-user.js";
import { NpmPackage } from "../../models/npmSchema.js";
import { Platform } from "../../models/platformSchema.js";
import { generateApiKey } from "../../utils/generateApiKey.js";
import FormData from "form-data"; // ✅ THIS ONE

import axios from "axios";
import bcrypt from "bcryptjs";
import { ExtractDomainParts, storeHostsConflict } from "../../helper/domain-existence.js";
import Domains from "../../models/domainSchema.js";
import { Referring } from "../../models/referringPeopleSchema.js";
import { resolveAffiliateRegistrationDraft } from "../../utils/affiliateRegistrationDraft.js";

const getFileType = (mimetype = "", format = "") => {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";

  if (mimetype === "application/pdf") return "pdf";

  // Excel
  if (
    mimetype ===
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimetype === "application/vnd.ms-excel"
  ) {
    return "excel";
  }

  // Fallback using format if mimetype missing
  if (["jpg", "jpeg", "png", "webp"].includes(format)) return "image";
  if (["mp4", "mov", "avi", "mkv"].includes(format)) return "video";
  if (["pdf"].includes(format)) return "pdf";
  if (["xls", "xlsx"].includes(format)) return "excel";

  return "other";
};

const resolveDocumentType = (mediaFile, originalFile) => {
  const format = mediaFile?.format?.toLowerCase?.() || "";
  if (format) return format;

  const fromName = originalFile?.originalname?.split(".").pop()?.toLowerCase();
  if (fromName) return fromName;

  const mimetype = mediaFile?.mimetype || originalFile?.mimetype || "";
  if (mimetype.includes("/")) {
    const subtype = mimetype.split("/")[1]?.split("+")[0];
    if (subtype) return subtype;
  }

  return "other";
};

const mapUploadedDocument = (mediaFile, originalFile) => {
  const mimetype = mediaFile?.mimetype || originalFile?.mimetype || "";
  const format = resolveDocumentType(mediaFile, originalFile);

  return {
    url: mediaFile.url,
    type: format,
    fileType: getFileType(mimetype, format),
    thumbnail: mediaFile.thumbnail ?? null,
    width: mediaFile.width,
    height: mediaFile.height,
    mimetype,
    size: mediaFile.size ?? originalFile?.size,
  };
};

export const registerAdmin = async (req, res) => {
  try {
    const { mobile, password, email, domain: domainUrl, type } = req.body;

    let userType = type || "ADMIN";

    if (!mobile || !password || !email || !domainUrl) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // ✅ Check if SUPER_ADMIN already exists
    if (type === "SUPER_ADMIN") {
      const existingSuperAdmin = await AffUser.findOne({
        userType: "SUPER_ADMIN",
      });
      // if (existingSuperAdmin) {
      //   // return res.status(403).json({
      //   //   message:
      //   //     "A SUPER_ADMIN account already exists. Registration not allowed.",
      //   // });
      // }
      if (existingSuperAdmin) {
        if (type === "SUPER_ADMIN") {
          console.log(
            "⚠ SUPER_ADMIN already exists → updating this user to ADMIN"
          );
        }
        userType = "ADMIN"; // force admin
      } else {
        // No super admin exists yet → allow the first one to be SUPER_ADMIN
        if (type !== "SUPER_ADMIN") {
          userType = "ADMIN";
        }
      }
    }

    // ✅ Check for existing email or mobile
    const existingUser = await AffUser.findOne({
      $or: [{ email }, { mobile }],
    });

    if (existingUser) {
      if (existingUser.email === email) {
        return res.status(400).json({ message: "Email already registered" });
      }
      if (existingUser.mobile === mobile) {
        return res
          .status(400)
          .json({ message: "Mobile number already registered" });
      }
    }

    // ✅ Validate domain format
    const domainPattern =
      /^(https?:\/\/)([a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*)(\.[a-z]{2,})(\/)?$/;
    if (!domainPattern.test(domainUrl)) {
      return res.status(400).json({
        message: `Invalid domain:${domainUrl} format. Example: https://www.uracca.com or https://admin.uracca.in`,
      });
    }

    // ✅ Extract domain parts
    const { name: domainName } = ExtractDomainParts(domainUrl);

    // Full host + TLD: uracca.com vs shop.uracca.com conflict;
    // uracca.com vs example.uracca.in do not (different host/TLD).
    const allDomains = await Domains.find({}, { name: 1, url: 1 });
    const isConflict = allDomains.some((d) => storeHostsConflict(domainUrl, d.url));

    if (isConflict) {
      return res.status(400).json({
        message: "This or a related subdomain/base domain already exists.",
      });
    }

    // ✅ Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // ✅ Create Domain first
    const newDomain = new Domains({
      registeredUserId: null, // will update after creating user
      name: domainName,
      url: domainUrl,
    });
    // await newDomain.save();

    // ✅ Create User with domain ObjectId
    const newUser = new AffUser({
      mobile,
      email,
      password: hashedPassword,
      userType: userType,
      status: type === "SUPER_ADMIN" ? "APPROVED" : "PENDING",
      userName: domainName,
      domain: newDomain._id, // assign ObjectId
    });
    await newUser.save();

    // ✅ Update Domain with registeredUserId
    newDomain.registeredUserId = newUser._id;
    await newDomain.save();

    //  create api key  ==================
    // await NpmPackage.create({
    //   platformName: domainName || "",
    //   domain: domainUrl,
    //   apiKey: generateApiKey(),
    // });
    //  ===================================

    // ✅ Create Platform entry
    const platform = new Platform({
      adminId: newUser._id,
      adminType: type || "ADMIN",
      domain: domainUrl,
    });
    await platform.save();

    // 🚀 VERY IMPORTANT PART:
    // Save platformId inside user schema
    newUser.platformId = platform._id;
    await newUser.save();

    return res.status(201).json({
      message: "Registration successful",
      user: newUser,
      platform,
    });
  } catch (error) {
    console.error("Register Error:", error);
    return res.status(500).json({
      message: "Server error during registration",
      error: error.message,
    });
  }
};

export const registerUser = async (req, res) => {
  try {
    /* ------------------------------------------------
       1️⃣ Extract primitive fields
    ------------------------------------------------ */
    const {
      userName,
      fullName,
      email,
      mobile,
      password,
      panNumber,
      referralId,
      subCategory,
    } = req.body;

    console.log(req.body, "req.body");
    console.log(subCategory, "subCategory");

    /* ------------------------------------------------
       2️⃣ Extract nested fields SAFELY
    ------------------------------------------------ */
    const address = {
      country: req.body?.address?.country || "",
      state: req.body?.address?.state || "",
      city: req.body?.address?.city || "",
      pinCode: req.body?.address?.pinCode || "",
      street: req.body?.address?.street || "",
    };

    const social = {
      instagram: req.body?.social?.instagram || "",
      youtube: req.body?.social?.youtube || "",
      facebook: req.body?.social?.facebook || "",
    };

    const files = req.files || [];

    /* ------------------------------------------------
       3️⃣ Incomplete OTP signups are drafts — reuse them
    ------------------------------------------------ */
    const { draftUser, error: registrationConflict } =
      await resolveAffiliateRegistrationDraft({ email, mobile });

    if (registrationConflict) {
      return res.status(registrationConflict.status).json({
        message: registrationConflict.message,
        field: registrationConflict.field,
      });
    }

    /* ------------------------------------------------
       4️⃣ Upload documents to Media Server
    ------------------------------------------------ */
    let documentsForDB = [];

    if (files.length) {
      const axiosForm = new FormData();

      // ✅ Append ONLY primitive fields
      const primitiveFields = [
        "userName",
        "fullName",
        "email",
        "mobile",
        "password",
        "panNumber",
        "referralId",
        "subCategory",
      ];

      primitiveFields.forEach((key) => {
        if (req.body[key]) {
          axiosForm.append(key, String(req.body[key]));
        }
      });

      // address
      Object.entries(address).forEach(([key, val]) => {
        if (val) axiosForm.append(`address[${key}]`, String(val));
      });

      // social
      Object.entries(social).forEach(([key, val]) => {
        if (val) axiosForm.append(`social[${key}]`, String(val));
      });

      // ✅ Buffer is allowed with form-data
      for (const file of files) {
        axiosForm.append("documents", file.buffer, {
          filename: file.originalname,
          contentType: file.mimetype,
          knownLength: file.size,
        });
      }

      const category = userName;
      const hasSubCategory = Boolean(subCategory?.trim());

      const uploadUrl = `${process.env.MEDIA_SERVER_URL}/upload/${process.env.MEDIA_SERVER_UPLOAD_ORIGIN
        }/${category}${hasSubCategory ? `/${subCategory}` : ""}`;

      let mediaRes;
      try {
        mediaRes = await axios.post(uploadUrl, axiosForm, {
          headers: {
            ...axiosForm.getHeaders(),
            "x-api-key": process.env.MEDIA_SERVER_API_KEY,
          },
          maxBodyLength: Infinity,
        });
      } catch (err) {
        console.error("MEDIA UPLOAD ERROR:", err.response?.data || err.message);
        return res.status(400).json({
          message: "Media upload failed",
          error: err.response?.data,
        });
      }

      const uploaded = mediaRes.data.files;
      const uploadedList = Array.isArray(uploaded) ? uploaded : [uploaded];

      documentsForDB = uploadedList.map((f, idx) =>
        mapUploadedDocument(f, files[idx])
      );
    }

    /* ------------------------------------------------
       5️⃣ Hash password
    ------------------------------------------------ */
    const hashedPassword = await bcrypt.hash(password, 10);

    /* ------------------------------------------------
       6️⃣ Create or update unverified draft
    ------------------------------------------------ */
    let newUser;
    let parentUser = null;

    if (draftUser) {
      draftUser.userName = userName;
      draftUser.fullName = fullName;
      draftUser.email = email;
      draftUser.mobile = mobile;
      draftUser.panNumber = panNumber;
      draftUser.address = [address];
      draftUser.social = social;
      draftUser.password = hashedPassword;
      if (documentsForDB.length) {
        draftUser.documents = documentsForDB;
      }
      draftUser.status = "PENDING";
      draftUser.registrationVerified = false;
      newUser = await draftUser.save();
    } else {
      if (referralId) {
        parentUser = await AffUser.findOne({ referralId });
        if (parentUser) {
          parentUser.referralCount += 1;
          await parentUser.save();
        }
      }

      newUser = await AffUser.create({
        userName,
        fullName,
        email,
        mobile,
        panNumber,
        address: [address],
        social,
        password: hashedPassword,
        documents: documentsForDB,
      });

      if (parentUser) {
        await Referring.create({
          parentUser: parentUser._id,
          childUser: newUser._id,
          referralCode: referralId,
          level: 1,
        });
      }
    }

    /* ------------------------------------------------
       7️⃣ Send OTP — admin is notified only after verify
    ------------------------------------------------ */
    try {
      const otp = await handleOtpSending(mobile);
      if (!otp) {
        return res.status(400).json({
          message:
            "Registration saved. OTP could not be sent. Please check the mobile number and resend OTP.",
          user: {
            id: newUser._id,
            email: newUser.email,
            mobile: newUser.mobile,
          },
        });
      }

      newUser.otp = otp;
      newUser.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
      await newUser.save();
    } catch (otpErr) {
      console.error("OTP SEND ERROR:", otpErr);
      return res.status(400).json({
        message:
          otpErr.message ||
          "Registration saved. OTP failed to send. Please resend OTP.",
        user: {
          id: newUser._id,
          email: newUser.email,
          mobile: newUser.mobile,
        },
      });
    }

    return res.status(201).json({
      message: "User registered successfully. OTP sent.",
      user: {
        id: newUser._id,
        email: newUser.email,
        mobile: newUser.mobile,
      },
    });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    return res.status(500).json({
      message: "Internal Server Error",
      error: err.message,
    });
  }
};
