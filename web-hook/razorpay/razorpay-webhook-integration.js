import { validateWebhookSignature } from "razorpay/dist/utils/razorpay-utils.js";
import {
  completeWithdrawal,
  failPayout,
  reversePayout,
} from "../../helper/withdrawalWallet.js";

const SECRET = process.env.RAZORPAY_WEBHOOK_SECRET;

export const razorpayWebhook = async (req, res) => {
  const rawBody = req.body;

  if (!rawBody) {
    console.log("RAW BODY STILL MISSING!");
  }

  const razorpaySignature = req.headers["x-razorpay-signature"];
  const webhookSecret = SECRET;

  validateWebhookSignature(
    rawBody.toString(),
    razorpaySignature,
    webhookSecret
  );

  try {
    const data = JSON.parse(rawBody.toString());
    const event = data.event;
    const payload = data.payload;

    if (event === "payout.processed") {
      const payout = payload.payout.entity;
      const result = await completeWithdrawal({
        razorpayPayoutId: payout.id,
        paymentReference: payout.id,
        paymentMethod: "RAZORPAY",
      });

      if (result.code === "ok") {
        console.log(`✅ Payout ${payout.id} marked COMPLETED`);
      } else if (result.code === "alreadySettled") {
        console.log(`ℹ️ Payout ${payout.id} already settled (idempotent)`);
      } else if (result.code === "notFound") {
        console.warn(`⚠️ Payout ${payout.id}: withdrawal not found`);
      } else if (result.code === "invalidStatus") {
        console.warn(
          `⚠️ Payout ${payout.id}: invalid status ${result.currentStatus}`
        );
      } else if (result.code === "walletUpdateFailed") {
        console.error(
          `❌ Payout ${payout.id}: wallet update failed after claim`,
          result.error
        );
        return res.status(500).json({ success: false, code: result.code });
      }
    }

    if (event === "payout.failed") {
      const payout = payload.payout.entity;
      const result = await failPayout({ razorpayPayoutId: payout.id });

      if (result.code === "ok") {
        console.log(`❌ Payout ${payout.id} marked FAILED (lock released)`);
      } else if (result.code === "alreadySettled") {
        console.log(`ℹ️ Payout ${payout.id} fail already settled`);
      } else if (result.code === "notFound") {
        console.warn(`⚠️ Payout ${payout.id}: withdrawal not found on fail`);
      } else if (result.code === "invalidStatus") {
        console.warn(
          `⚠️ Payout ${payout.id}: cannot fail from ${result.currentStatus}`
        );
      } else if (result.code === "walletUpdateFailed") {
        console.error(`❌ Payout ${payout.id}: fail wallet update failed`, result.error);
        return res.status(500).json({ success: false, code: result.code });
      }
    }

    if (event === "payout.reversed") {
      const payout = payload.payout.entity;
      const result = await reversePayout({ razorpayPayoutId: payout.id });

      if (result.code === "ok") {
        console.log(
          `✅ Payout ${payout.id} marked REVERSED` +
            (result.walletUnchanged ? " (status only)" : "")
        );
      } else if (result.code === "alreadySettled") {
        console.log(`ℹ️ Payout ${payout.id} reverse already settled`);
      } else if (result.code === "notFound") {
        console.warn(`⚠️ Payout ${payout.id}: withdrawal not found on reverse`);
      } else if (result.code === "invalidStatus") {
        console.warn(
          `⚠️ Payout ${payout.id}: cannot reverse from ${result.currentStatus}`
        );
      } else if (result.code === "walletUpdateFailed") {
        console.error(
          `❌ Payout ${payout.id}: reverse wallet update failed`,
          result.error
        );
        return res.status(500).json({ success: false, code: result.code });
      }
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ Webhook error:", err);
    res.status(500).json({ success: false });
  }
};
