import AffUser from "../../models/aff-user.js";
import { Campaign } from "../../models/campaignSchema.js";
import { Product } from "../../models/productSchema.js";
import { encryptData } from "../../utils/cript-data.js";
import generateUniqueCampaignAccessKey from "../../utils/generate-keys.js";
import { InitAffiliate, TrackClick } from "@haash/affiliate";
import { DailyActionUpdater } from "../../utils/recordAction.js";
import { UserActionEnum, UserCategoryEnum } from "../../models/enum.js";
import {
  campaignActionFromStatus,
  notifyAdmin,
} from "../../utils/notifyAdmin.js";

export const createCampaign = async (req, res) => {
  try {
    const {
      productId,
      slug,
      domain,
      returnPeriod,
      accountId,
      title,
      image,
      mrp,
      category,
      categoryId,
    } = req.body;
    //   image: String,
    //   title: String,
    //   mrp: String,
    //   category: String,
    if (!productId || !slug || !domain || !accountId) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }

    const user = req.user; // ✅ user from middleware
    if (!user) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!user.workingOn) {
      return res.status(400).json({
        success: false,
        message: "Select an active company before creating a campaign",
      });
    }

    if (accountId.toString() !== user.workingOn.toString()) {
      return res.status(403).json({
        success: false,
        message: "Campaign account must match your active company",
      });
    }

    // Generate unique key
    const campaignAccessKey = await generateUniqueCampaignAccessKey();

    // Generate campaign link with user's referral ID
    const campaignLink = `${domain}products/${slug}?aff=${user.referralId}&campKey=${campaignAccessKey}`;

    // Create new campaign
    const newCampaign = new Campaign({
      userId: user._id,
      company: {
        domain,
        accountId, // ✅ passed from body (admin/platform account ID)
      },
      campaignLink,
      returnPeriod,
      campaignAccessKey,
      product: {
        productId,
        title,
        image,
        mrp,
        category,
        categoryId,
      },
    });

    const savedCampaign = await newCampaign.save();

    // Update user with campaign details
    await AffUser.findByIdAndUpdate(
      user._id,
      {
        $addToSet: {
          campaignAccessKey,
          campaignId: savedCampaign._id,
        },
      },
      { new: true }
    );

    // ============ Affiliate daily action ==============
    await new DailyActionUpdater(user._id, accountId)
      .increment("activeCampaigns")
      .apply();
    // ============ Affiliate daily action ==============

    const who = user.fullName || user.userName || "Affiliate";
    const productTitle = title || productId || "product";
    await notifyAdmin({
      adminId: accountId,
      action: UserActionEnum.CAMPAIGN_CREATED,
      category: UserCategoryEnum.CAMPAIGN,
      message: `${who} created a campaign for ${productTitle}`,
      metadata: {
        campaignId: savedCampaign._id,
        userId: user._id,
        productId,
        campaignAccessKey,
      },
    });

    res.status(201).json({
      success: true,
      message: "Campaign created successfully",
      data: {
        campaignId: savedCampaign._id,
        campaignAccessKey,
        campaignLink,
      },
    });
  } catch (error) {
    console.error("Error creating campaign:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create campaign",
      error: error.message,
    });
  }
};

//   ==== get users campaigns ===
export const getUserCampaigns = async (req, res, next) => {
  try {
    const userId = req.user ? req.user?._id : req.params.userId;
    // console.log(user, "user getUserCampaigns");

    if (!userId) {
      // return res.status(401).json({ success: false, message: "Unauthorized" });
      throw new Error("Unauthorized");
    }

    // Optional filter: only campaigns for a specific admin/platform
    const { accountId, date, sort, campaignId } = req.query;
    // console.log(req.query, "req.query");

    const query = { userId: userId };
    if (accountId) {
      query["company.accountId"] = accountId;
    }

    // ✅ NEW: filter by campaignId (single campaign)
    if (campaignId) {
      query._id = campaignId;
    }

    // Default sorting
    let sortQuery = { createdAt: -1 }; // latest

    //   sort with date
    if (date === "newest") {
      sortQuery = { createdAt: -1 }; // newest
    }
    if (date === "oldest") {
      sortQuery = { createdAt: 1 }; // oldest
    }

    // 🔥 Commission sorting
    if (sort === "high") {
      sortQuery = { "commissionDetails.totalCommissionWithTds": -1 };
    }
    if (sort === "low") {
      sortQuery = { "commissionDetails.totalCommissionWithTds": 1 };
    }

    const campaigns = await Campaign.find(query)
      .sort(sortQuery)
      .populate("userId commissionRecords");

    // Admin sees all campaigns (INACTIVE visible with status).
    // Affiliate client hides INACTIVE campaigns / inactive products.
    const isAdminRequest = Boolean(req.admin);

    const productIds = [
      ...new Set(
        campaigns
          .map((c) => c.product?.productId?.toString())
          .filter(Boolean)
      ),
    ];

    const localProducts =
      productIds.length > 0
        ? await Product.find({ productId: { $in: productIds } })
          .select("productId isActive status")
          .lean()
        : [];

    const productMap = new Map(
      localProducts.map((p) => [p.productId.toString(), p])
    );

    const visibleCampaigns = [];
    for (const campaign of campaigns) {
      const pid = campaign.product?.productId?.toString();
      const local = pid ? productMap.get(pid) : null;
      const productInactive = local && local.isActive === false;
      const campaignInactive = campaign.status === "INACTIVE";

      // Affiliate client only: hide inactive campaign / product
      if (!isAdminRequest && (campaignInactive || productInactive)) {
        continue;
      }

      const plain = campaign.toObject();
      if (local) {
        plain.productStatus = local.status;
        plain.productIsActive = local.isActive;
      }
      // Admin UI: surface product off-switch as INACTIVE status
      if (productInactive) {
        plain.productIsActive = false;
      }
      visibleCampaigns.push(plain);
    }

    const encryptedData = encryptData(visibleCampaigns);

    res.status(200).json({
      success: true,
      message: "User campaigns fetched successfully",
      data: encryptedData,
    });
  } catch (error) {
    // console.error("Error fetching user campaigns:", error);
    // res.status(500).json({
    //   success: false,
    //   message: "Failed to fetch campaigns",
    //   error: error.message,
    // });
    next(error);
  }
};

// =====================================================
// ============== UPDATE CAMPAIGN ======================
// =====================================================

export const genericUpdateCampaigns = async (req, res, next) => {
  try {
    const { campaignId } = req.params; // ← FIXED: you must pass campaignId
    const adminId = req.admin ? req.admin._id : null;
    const updateData = req.body;

    // console.log(req.admin,'adminId in genericUpdateCampaigns');

    // console.log(updateData,'updateData in genericUpdateCampaigns');

    const updatedCampaign = await updateAffUserCampaignWidget(
      campaignId,
      adminId,
      updateData
    );

    const encryptedData = encryptData(updatedCampaign);

    return res.status(200).json({
      success: true,
      message: "Campaign updated successfully",
      data: encryptedData,
    });
  } catch (err) {
    next(err);
    // return res.status(500).json({
    //   success: false,
    //   message: "Internal server error while updating campaign",
    //   error: err.message,
    // });
  }
};

export const updateAffUserCampaignWidget = async (
  campaignId,
  adminId,
  updateData
) => {
  // 1. Make sure campaign exists & belongs to this admin
  const existing = await Campaign.findOne({
    _id: campaignId,
    "company.accountId": adminId, // only update if this admin owns it
  });

  if (!existing) {
    throw new Error("Campaign not found or not owned by this admin");
  }

  const previousStatus = existing.status;

  // 2. Update the campaign
  const updatedCampaign = await Campaign.findByIdAndUpdate(
    campaignId,
    { $set: updateData },
    { new: true, runValidators: true }
  );

  if (!updatedCampaign) {
    throw new Error("Failed to update campaign");
  }

  if (
    adminId &&
    updateData?.status &&
    String(previousStatus) !== String(updatedCampaign.status)
  ) {
    const action = campaignActionFromStatus(updatedCampaign.status);
    if (action) {
      const member = await AffUser.findById(updatedCampaign.userId)
        .select("fullName userName")
        .lean();
      const who = member?.fullName || member?.userName || "Affiliate";
      const productTitle =
        updatedCampaign.product?.title || updatedCampaign.campaignAccessKey;
      await notifyAdmin({
        adminId,
        action,
        category: UserCategoryEnum.CAMPAIGN,
        message: `Campaign for ${productTitle} (${who}) is now ${updatedCampaign.status}`,
        metadata: {
          campaignId: updatedCampaign._id,
          userId: updatedCampaign.userId,
          previousStatus,
          status: updatedCampaign.status,
        },
      });
    }
  }

  return updatedCampaign;
};
