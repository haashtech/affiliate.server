import { ExtractDomainParts, normalizeStoreUrl } from "../../helper/domain-existence.js";
import { NpmPackage } from "../../models/npmSchema.js";
import { Platform } from "../../models/platformSchema.js";
import { generateApiKey } from "../../utils/generateApiKey.js";

// ---------------------- 📋 Get Platform Settings ----------------------
export const getPlatformSettings = async (req, res) => {
  try {
    // Always fetch the first (and only) Platform document
    const adminId = req.admin._id;
    // console.log(adminId, "req in getPlatformSettings");
    if (!adminId) {
      return res.status(400).json({
        success: false,
        message: "Admin ID is required to fetch platform settings",
      });
    }

    let platform = await Platform.findOne({ adminId }).populate("accessKey");
    if (!platform) {
      return res.status(404).json({
        success: false,
        message: "Platform settings not found for the given admin ID",
      });
    }

    // if (!platform) {
    //     // ✅ Create default platform matching the new schema
    //     platform = await Platform.create({
    //       domain: "",
    //       commission: 0,
    //       adminId:adminId,
    //       paymentMethods: {
    //         type: "ENTER",
    //         minAmount: 0,
    //         maxAmount: 0,
    //         amount: [],
    //       },

    //       bankTransfer: {
    //         enabled: true,
    //         amountType: "PERCENT",
    //         transferCharge: 0,
    //       },

    //       onlineTransfer: {
    //         enabled: true,
    //         amountType: "PERCENT",
    //         transferCharge: 0,
    //       },

    //       tdsLinkedMethods: {
    //         type: "PERCENT",
    //         amount: 0,
    //       },

    //       tdsUnLinkedMethods: {
    //         type: "PERCENT",
    //         amount: 0,
    //       },

    //       termAndConditions: {
    //         rules: [],
    //         policy: "",
    //       },
    //     });
    //   }

    return res.status(200).json({
      success: true,
      message: "Platform settings fetched successfully",
      data: platform,
    });
  } catch (error) {
    console.error("❌ Error fetching platform settings:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching platform settings",
      error: error.message,
    });
  }
};

export const getPlatformForUserSettings = async (req, res) => {
  try {
    // Always fetch the first (and only) Platform document
    const adminId = req.params.adminId;
    console.log(adminId, "req in getPlatformSettings");
    if (!adminId) {
      return res.status(400).json({
        success: false,
        message: "Admin ID is required to fetch platform settings",
      });
    }

    let platform = await Platform.findOne({ adminId });

    if (!platform) {
      return res.status(404).json({
        success: false,
        message: "Platform settings not found for the given admin ID",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Platform settings fetched successfully",
      data: platform,
    });
  } catch (error) {
    console.error("❌ Error fetching platform settings:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching platform settings",
      error: error.message,
    });
  }
};

// ---------------------- 📋 Update Platform Settings ----------------------
export const updatePlatformSettings = async (req, res, next) => {
  try {
    const { updateFields } = req.body;
    if (updateFields?.domain) {
      updateFields.domain = normalizeStoreUrl(updateFields.domain);
    }
    const adminId = req.admin._id;
    // Always update the first Platform document
    let platform = await Platform.findOne({ adminId });

    if (!platform) {
      // If no Platform exists, create one
      platform = await Platform.create(updateFields);
    } else {
      // Update the existing Platform
      Object.keys(updateFields).forEach((key) => {
        platform[key] = updateFields[key];
      });
      await platform.save();
    }
    // 3️⃣ Handle NpmPackage auto-create based on domain
    if (platform.domain && !platform.accessKey) {
      let npmPkg = await NpmPackage.findOne({ domain: platform.domain });
      // ✅ Extract domain parts
      const { name: domainName, base: baseDomain } = ExtractDomainParts(
        platform.domain
      );
      // console.log(platform.domain);

      // If no package exists for this domain → create new npm package
      if (!npmPkg) {
        console.log("Creating new NpmPackage for domain:", domainName);

        npmPkg = await NpmPackage.create({
          platformName: baseDomain || "Haash Platform",
          domain: platform.domain,
          apiKey: generateApiKey(),
        });
      }

      // Save the npmPackage ID as platform.accessKey (your requirement)
      platform.accessKey = npmPkg._id;
      await platform.save();
    }

    return res.status(200).json({
      success: true,
      message: "Platform settings updated successfully",
      data: platform,
    });
  } catch (error) {
    console.error("❌ Error updating platform settings:", error);
    next(error);
    // return res.status(500).json({
    //   success: false,
    //   message: "Server error while updating platform settings",
    //   error: error.message,
    // });
  }
};
