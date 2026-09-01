import axios from "axios";

/**
 * Admin product routes require a store admin token. Server-to-server calls from
 * affiliate.server should use the public catalog endpoint instead.
 */
export const toPublicProductsUrl = (productsUrl) => {
  if (!productsUrl) return productsUrl;

  if (process.env.STORE_PRODUCTS_URL) {
    return process.env.STORE_PRODUCTS_URL;
  }

  if (productsUrl.includes("getAllProducts_admin")) {
    return productsUrl.replace(
      /getAllProducts_admin\/?$/,
      "fetchNewProducts"
    );
  }

  return productsUrl;
};

export const normalizeProductsResponse = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.products)) return data.products;
  if (Array.isArray(data?.data)) return data.data;
  return [];
};

export const fetchPlatformProducts = async (productsUrl) => {
  const url = toPublicProductsUrl(productsUrl);

  const response = await axios.get(url, {
    timeout: 30000,
    validateStatus: (status) => status < 500,
  });

  if (response.status >= 400) {
    const error = new Error(
      response.data?.message || `Store products request failed (${response.status})`
    );
    error.response = response;
    throw error;
  }

  return normalizeProductsResponse(response.data);
};
