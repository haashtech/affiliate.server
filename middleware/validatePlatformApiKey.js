import { NpmPackage } from "../models/npmSchema.js";
import { InvalidError, MissingFieldError } from "../utils/errors.js";

const normalizeOrigin = (url) => {
  if (!url) return "";
  return String(url).trim().replace(/\/$/, "").toLowerCase();
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
    const cleanDbDomain = normalizeOrigin(platform.domain);
    const cleanOrigin = normalizeOrigin(origin);

    if (
      (cleanOrigin && isLocalHost(cleanOrigin)) ||
      isLocalHost(cleanHeaderDomain)
    ) {
      req.platform = platform;
      return next();
    }

    if (cleanHeaderDomain !== cleanDbDomain) {
      throw new InvalidError("Domain mismatch");
    }

    if (cleanOrigin && cleanOrigin !== cleanDbDomain) {
      throw new InvalidError("Domain mismatch");
    }

    req.platform = platform;
    next();
  } catch (err) {
    next(err);
  }
};
