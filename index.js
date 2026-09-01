import express from "express";
import chalk from "chalk";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import morgan from "morgan";
import session from "express-session";
import cookieSession from "cookie-session";
import dotenv from "dotenv";
import path from "path";
import { errorHandler } from "./middleware/errorMiddleware.js";
import { fileURLToPath } from "url";
import connectDB from "./config/db.js";

// routers =======
import userRouter from "./routes/user-route.js";
import withdrawalRouter from "./routes/withdrawal-route.js";
import feedbackRouter from "./routes/feedback-route.js";
import platformRouter from "./routes/platform-routes.js";
import testRouter from "./routes/test-route.js";
import productRouter from "./routes/product-route.js";
import campaignRouter from "./routes/campaign-route.js";
import affiliateRouter from "./routes/affiliate-route.js";
import walletRouter from "./routes/wallet-route.js";
import bulkRouter from "./routes/bulk-route.js";
import NotificationRouter from "./routes/notifications.route.js";

import CommissionRouter from "./routes/commission-route.js";
import NpmRouter from "./routes/npm-route/route.js";
import tierRouter from "./routes/tier.route.js";
import ticketRouter from "./routes/ticket.route.js";

// import { createLimiter } from "./middleware/rateLimit.js";
import { rateLimitConfig } from "./config/rateLimitConfig.js";
import { makeLimiter } from "./middleware/rateLimiter.js";

import "./utils/loadEnv.js";
import "./cron/commissionPayoutJob.js";

// === web hook ====== //
import WebHookRouter from "./routes/web-hook-route.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

app.use("/public", express.static(path.join(__dirname, "public")));

app.use(
  cookieSession({
    name: "session",
    keys: ["key1", "key2"],
  })
);

/* ---------------------- RAW BODY FOR WEBHOOK FIRST ---------------------- */
app.use(
  "/api/web-hook/razorpay/withdrawal-payout",
  express.raw({ type: "application/json" })
);

/* ---------------------- NORMAL PARSERS AFTER --------------------------- */
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(helmet());
app.use(morgan("dev"));
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);

app.use(morgan("dev"));

/* ---------------------- ORIGIN GATE --------------------------- */
const baseOrigins = [
  "https://www.uracca.com",
  "https://uracca.com",
  "https://www.uracca.in",
  "https://uracca.in",
  "https://www.admin.uracca.com",
  "https://admin.uracca.com",
  "https://www.admin.uracca.in",
  "https://admin.uracca.in",
  "https://affiliate.uracca.com",
  "https://example.admin.uracca.in",
  "https://example.uracca.in",
];

// Parse env origins (if any)
const extraOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
      .map((o) => o.trim())
      .filter(Boolean)
  : [];

// Merge base + extra (no duplicates)
const allowedOrigins = Array.from(new Set([...baseOrigins, ...extraOrigins]));
// console.log(allowedOrigins.co,'extraOrigins');


app.use(
  cors({
    origin: (origin, callback) => {
      // console.log("Allowed origins:", allowedOrigins);
      // console.log("🔥 Incoming CORS request from:", origin);
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log("❌ Blocked Origin:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // allowedHeaders: "*",
    allowedHeaders: ["Content-Type", "Authorization", "x-api-key","x-domain"],


    credentials: true,
  })
);

// ------- admins apis ----------- ////

// Sort routes so deeper paths apply first
rateLimitConfig
  .sort((a, b) => b.route.length - a.route.length)
  .forEach((item) => {
    if (item.noLimit) {
      console.log("No limit applied for", item.route);
      return;
    }

    const limiter = makeLimiter(item.window, item.max);

    // console.log(process.env.NODE_ENV);
    const development = process.env.NODE_ENV;
    if (development) {
      console.log(
        `Rate limit applied → ${item.route} | ${item.max} req / ${item.window}`
      );
    }

    app.use(item.route, limiter);
  });


  /* ---------------------- ROUTES ---------------------------- */
app.get("/", (req, res) => res.send("success"));

app.use("/api/user", userRouter);
app.use("/api/admin/withdrawal", withdrawalRouter);
app.use("/api/admin/feedbacks", feedbackRouter);
app.use("/api/admin/platform", platformRouter);
app.use("/api/admin/products", productRouter);
// app.use("/test/order", testRouter);

app.use("/api/admin/bulk-details", bulkRouter);
app.use("/api/admin/notifications", NotificationRouter);
app.use("/api/admin/ticket", ticketRouter);


// ------- users apis ----------- ////
app.use("/api/users/products", productRouter);
app.use("/api/users/campaign", campaignRouter);
app.use("/api/users/commission", CommissionRouter);
app.use("/api/users/bulk-details", bulkRouter);

// ------- affiliate apis ----------- ////
app.use("/api/affiliate", affiliateRouter);
app.use("/api/wallet", walletRouter);
app.use("/api/user/withdrawal", withdrawalRouter);
app.use("/api/npm", NpmRouter);


// ------- webhook apis ----------- ////
app.use("/api/web-hook", WebHookRouter);

// ------- tier apis ----------- ////
app.use("/api/tier", tierRouter);


app.use(errorHandler);

/* ---------------------- SERVER ---------------------------- */

app.listen(PORT, "0.0.0.0", () => {
  console.log(chalk.cyan(`Server is running on port ${PORT}`));
});

connectDB();
