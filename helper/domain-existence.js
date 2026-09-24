import dns from "dns";
import url from "url";

/**
 * Extracts clean domain name and base name for conflict checking
 * Example:
 *   https://admin.uracca.com → { name: "admin.uracca", base: "uracca" }
 *   https://www.uracca.com → { name: "uracca", base: "uracca" }
 */
export const ExtractDomainParts = (fullUrl) => {
  const parsed = new URL(fullUrl);
  const hostname = parsed.hostname.replace(/^www\./, ""); // remove www
  const parts = hostname.split(".");
  if (parts.length < 2) throw new Error("Invalid domain format");

  // name = everything before .tld (e.g. admin.uracca)
  const name = parts.slice(0, -1).join(".");
  const base = parts.length >= 2 ? parts[parts.length - 2] : hostname;
  return { name, base };
};

/** Canonical store URL: trim and drop a trailing slash. Host is unchanged. */
export const normalizeStoreUrl = (value) => {
  if (!value || typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.replace(/\/+$/, "");
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
};

/** Hostname without www / trailing dot, including TLD. */
export const normalizeStoreHostname = (fullUrl) => {
  const hostname = new URL(fullUrl).hostname.replace(/^www\./i, "").toLowerCase();
  return hostname.replace(/\.$/, "");
};

/**
 * Same host or subdomain of the same host+TLD.
 * uracca.com vs www.uracca.com / shop.uracca.com → conflict
 * uracca.com vs example.uracca.in → no conflict
 */
export const storeHostsConflict = (newUrl, existingUrl) => {
  if (!newUrl || !existingUrl) return false;
  let newHost;
  let existingHost;
  try {
    newHost = normalizeStoreHostname(newUrl);
    existingHost = normalizeStoreHostname(existingUrl);
  } catch {
    return false;
  }
  return (
    existingHost === newHost ||
    existingHost.endsWith("." + newHost) ||
    newHost.endsWith("." + existingHost)
  );
};
