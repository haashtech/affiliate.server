import express from "express";
const router = express.Router();

import { getAllAdminsAffUsers, getAllAffUsers, getAllAffUsersForEachAdmins, getCurrentUsers, logoutAdmin } from "../controllers/user/user-controller.js";
import { updateAffUserStatus, genericUpdateAffUser } from "../controllers/user/user-updates.js";
import { loginUser, loginAdmin } from "../controllers/auth/auth-controller.js";
import { authenticateAdmin, authenticateUser } from "../middleware/middleware.js";
import { registerAdmin, registerUser } from "../controllers/auth/registration.controller.js";
import { upload } from "../middleware/upload.middleware.js";


router.get("/current-admin",authenticateAdmin, getCurrentUsers);


router.get("/all",authenticateAdmin, getAllAffUsersForEachAdmins);
router.post("/admin-login", loginAdmin);
router.post("/user-login", loginUser);

router.post("/admin-register", registerAdmin);

// multiple files => "documents"
router.post(
  "/user-register",
  upload.array("documents", 5),
  registerUser
);

router.get("/all-admins",authenticateUser, getAllAdminsAffUsers);
router.put("/update-status/:userId",authenticateAdmin, updateAffUserStatus);
router.put("/generic-update/:userId", authenticateAdmin, genericUpdateAffUser);
router.put("/generic-update-user/:userId",authenticateUser, genericUpdateAffUser);
router.post("/logout-admin",authenticateAdmin, logoutAdmin);

export default router;
