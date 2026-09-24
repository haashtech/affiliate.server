import AffUser from "../models/aff-user.js";
import { UserTypeEnum, statusEnum } from "../models/enum.js";

export const isUnverifiedAffiliateDraft = (user) =>
  Boolean(
    user &&
      user.userType === UserTypeEnum.USER &&
      !user.registrationVerified &&
      user.status === statusEnum.PENDING
  );

/**
 * Incomplete OTP signups are drafts: same email/mobile can be reused.
 * Verified or approved/rejected accounts stay unique.
 */
export const resolveAffiliateRegistrationDraft = async ({ email, mobile }) => {
  const existingByEmail = email ? await AffUser.findOne({ email }) : null;
  const existingByMobile = mobile ? await AffUser.findOne({ mobile }) : null;

  if (existingByEmail && !isUnverifiedAffiliateDraft(existingByEmail)) {
    return {
      error: {
        status: 409,
        field: "email",
        message: "Email already registered",
      },
    };
  }

  if (existingByMobile && !isUnverifiedAffiliateDraft(existingByMobile)) {
    return {
      error: {
        status: 409,
        field: "mobile",
        message: "Mobile number already registered",
      },
    };
  }

  let draftUser = null;

  if (isUnverifiedAffiliateDraft(existingByEmail)) {
    draftUser = existingByEmail;
  }

  if (isUnverifiedAffiliateDraft(existingByMobile)) {
    if (draftUser && String(draftUser._id) !== String(existingByMobile._id)) {
      await AffUser.deleteOne({ _id: existingByMobile._id });
    } else if (!draftUser) {
      draftUser = existingByMobile;
    }
  }

  return { draftUser };
};
