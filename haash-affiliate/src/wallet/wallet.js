import { API } from "../api/request.js";

export const CancelCommission = async (orderId, productId) => {
  if (!orderId) throw new Error("orderId is required");
  if (!productId) throw new Error("productId is required");
  return API.patch(`/affiliate/cancel-amount/${orderId}`, { productId });
};
