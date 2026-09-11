import express from "express";
const router = express.Router();

import {
  getAllAffWithdrawalHistory,
  processWithdrawal,
  updateAffWithdrawalStatus,
} from "../controllers/withdrawals/withdrawal-controller.js";
import { checkUserStatus } from "../middleware/checkUserStatus.js";
import {
  authenticateAdmin,
  authenticateUser,
} from "../middleware/middleware.js";
import { payWithdrawalToUser } from "../controllers/withdrawals/withdrawal-payout-controller.js";

router.get("/all", authenticateAdmin, getAllAffWithdrawalHistory);
router.patch(
  "/action",
  authenticateAdmin,
  checkUserStatus,
  updateAffWithdrawalStatus
);
router.patch("/payout", authenticateAdmin, payWithdrawalToUser);


// --------- user withdrawal route ------------- >
router.post(
  "/new-withdrawal/:adminId",
  authenticateUser,
  checkUserStatus,

  processWithdrawal
);

export default router;
