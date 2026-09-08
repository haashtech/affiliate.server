import express from "express";
import { authenticateUser } from "../middleware/middleware.js";
import {
  userAllCommissionDetails,
  userCommissionSummary,
} from "../controllers/commission/user-commission-controller.js";
const router = express.Router();

//  < -------- users commission routes -------- >  //
router.get("/all", authenticateUser, userAllCommissionDetails);
router.get("/summary", authenticateUser, userCommissionSummary);


export default router;
