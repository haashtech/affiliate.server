import DailyAction from "../models/actionSchema.js";
import AffUser from "../models/aff-user.js";

export class DailyActionUpdater {
  constructor(userId, adminId = null, date = null) {
    this.userId = userId;
    this.adminId = adminId; // optional
    this.today = date || new Date().toISOString().slice(0, 10);
    this.updateOps = {};
  }

  // auto load adminId if missing (UI paths only; tracking must pass campaign.company.accountId)
  async loadAdmin() {
    if (!this.adminId) {
      const user = await AffUser.findById(this.userId).select("workingOn");
      this.adminId = user?.workingOn;
    }
  }

  // -----------------------------
  // INCREMENT SAFELY
  // -----------------------------
  increment(field, value = 1) {
    if (!this.updateOps[field]) this.updateOps[field] = 0;
    this.updateOps[field] += Math.abs(value); // always positive
    return this;
  }

  // -----------------------------
  // DECREMENT SAFELY
  // -----------------------------
  decrement(field, value = 1) {
    if (!this.updateOps[field]) this.updateOps[field] = 0;
    this.updateOps[field] -= Math.abs(value); // always negative
    return this;
  }

  // -----------------------------
  // CONDITIONAL UPDATE
  // -----------------------------
  setIf(field, value, condition = true) {
    if (condition) {
      if (!this.updateOps[field]) this.updateOps[field] = 0;
      this.updateOps[field] += value;
    }
    return this;
  }

  // -----------------------------
  // APPLY TO DATABASE
  // -----------------------------
  async apply() {
    await this.loadAdmin(); // ⬅️ auto fetch admin if not passed

    if (!this.adminId) {
      console.warn("⚠ DailyActionUpdater: adminId not found for user", this.userId);
      return;
    }

    const doc = await DailyAction.findOne({
      userId: this.userId,
      adminId: this.adminId,
      date: this.today,
    });

    if (!doc) {
      const newDoc = new DailyAction({
        userId: this.userId,
        adminId: this.adminId,
        date: this.today,
      });

      // Apply increments/decrements safely
      for (const field in this.updateOps) {
        const newValue = (newDoc[field] || 0) + this.updateOps[field];
        newDoc[field] = Math.max(0, newValue);
      }

      newDoc.updatedAt = new Date();
      return await newDoc.save();
    }

    // Existing doc → update safely
    for (const field in this.updateOps) {
      const newValue = (doc[field] || 0) + this.updateOps[field];
      doc[field] = Math.max(0, newValue); // prevent negative
    }

    doc.updatedAt = new Date();
    return await doc.save();
  }
}
