import { NpmPackage } from "../models/npmSchema.js";
import { InvalidError, MissingFieldError } from "../utils/errors.js";

const normalizeOrigin = (url) => {
  if (!url) return "";
  return String(url).trim().replace(/\/$/, "").toLowerCase();
};

const canonicalHost = (value) => {
  if (!value) return "";
  try {
    const withProto = /^https?:\/\//i.test(value) ? value : `https://${value}`;
    return new URL(withProto).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return String(value)
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .replace(/^www\./i, "")
      .toLowerCase();
  }
};

const isLocalHost = (origin) => {
  return origin.includes("localhost") || origin.includes("127.0.0.1");
};

export const validatePlatformApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers["x-api-key"];
    const domain = req.headers["x-domain"];
    const origin = req.headers.origin;

    if (!apiKey || !domain) {
      throw new MissingFieldError("Missing headers");
    }

    const platform = await NpmPackage.findOne({ apiKey });
    if (!platform) {
      throw new InvalidError("Invalid apiKey");
    }

    const cleanHeaderDomain = normalizeOrigin(domain);
    const cleanOrigin = normalizeOrigin(origin);

    if (
      (cleanOrigin && isLocalHost(cleanOrigin)) ||
      isLocalHost(cleanHeaderDomain)
    ) {
      req.platform = platform;
      return next();
    }

    // x-domain identifies the NpmPackage tenant (www / trailing-slash insensitive).
    // Browser Origin is enforced by CORS, not here — storefront host can differ
    // from the package canonical domain (e.g. www.example.uracca.in vs example.uracca.com).
    if (canonicalHost(domain) !== canonicalHost(platform.domain)) {
      throw new InvalidError("Domain mismatch");
    }

    req.platform = platform;
    next();
  } catch (err) {
    next(err);
  }
};
