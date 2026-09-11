/**
 * Accounting simulation for withdrawal wallet rules (no Mongo required).
 * Mirrors helper/withdrawalWallet.js field contract.
 *
 * Run: node scripts/test-withdrawal-accounting.js
 */

const clamp = (n) => Math.max(0, n);

function createWallet(seed = {}) {
  return {
    balanceAmount: seed.balanceAmount ?? 5000,
    pendingAmount: seed.pendingAmount ?? 0,
    paidAmount: seed.paidAmount ?? 0,
    totalAmount: seed.totalAmount ?? 5000,
  };
}

function requestWithdrawal(wallet, requestedAmount, transferCharge = 0) {
  const withdrawalAmount = requestedAmount - transferCharge;
  wallet.balanceAmount -= requestedAmount;
  wallet.pendingAmount += withdrawalAmount;
  return {
    requestedAmount,
    withdrawalAmount,
    transferCharge,
    status: "PENDING",
    accountingApplied: false,
    accountingKind: null,
  };
}

function startProcessing(w) {
  if (w.status !== "PENDING") throw new Error("invalid PROCESSING");
  w.status = "PROCESSING";
  return w;
}

function complete(wallet, w) {
  if (!["PENDING", "PROCESSING"].includes(w.status) || w.accountingApplied) {
    return "alreadySettled_or_invalid";
  }
  w.status = "COMPLETED";
  w.accountingKind = "COMPLETE";
  wallet.paidAmount += w.withdrawalAmount;
  wallet.pendingAmount = clamp(wallet.pendingAmount - w.withdrawalAmount);
  w.accountingApplied = true;
  return "ok";
}

function reject(wallet, w) {
  if (!["PENDING", "PROCESSING"].includes(w.status) || w.accountingApplied) {
    return "alreadySettled_or_invalid";
  }
  const req = w.requestedAmount;
  const net = w.withdrawalAmount;
  w.status = "REJECTED";
  w.accountingKind = "RELEASE";
  // preserve amounts
  wallet.balanceAmount += req;
  wallet.pendingAmount = clamp(wallet.pendingAmount - net);
  w.accountingApplied = true;
  return "ok";
}

function fail(wallet, w) {
  if (!["PENDING", "PROCESSING"].includes(w.status) || w.accountingApplied) {
    return "alreadySettled_or_invalid";
  }
  w.status = "FAILED";
  w.accountingKind = "RELEASE";
  wallet.balanceAmount += w.requestedAmount;
  wallet.pendingAmount = clamp(wallet.pendingAmount - w.withdrawalAmount);
  w.accountingApplied = true;
  return "ok";
}

function reverse(wallet, w) {
  if (w.status === "REVERSED" && w.accountingApplied) return "alreadySettled";
  if (w.status === "FAILED" && w.accountingApplied && w.accountingKind === "RELEASE") {
    w.status = "REVERSED";
    return "ok_status_only";
  }
  if (w.status === "COMPLETED" && w.accountingApplied && w.accountingKind === "COMPLETE") {
    w.status = "REVERSED";
    w.accountingKind = "REVERSE_AFTER_COMPLETE";
    wallet.balanceAmount += w.requestedAmount;
    wallet.paidAmount = clamp(wallet.paidAmount - w.withdrawalAmount);
    w.accountingApplied = true;
    return "ok_undo";
  }
  if (["PENDING", "PROCESSING"].includes(w.status) && !w.accountingApplied) {
    w.status = "REVERSED";
    w.accountingKind = "RELEASE";
    wallet.balanceAmount += w.requestedAmount;
    wallet.pendingAmount = clamp(wallet.pendingAmount - w.withdrawalAmount);
    w.accountingApplied = true;
    return "ok_release";
  }
  return "invalidStatus";
}

function openPendingSum(withdrawals) {
  return withdrawals
    .filter((w) => ["PENDING", "PROCESSING"].includes(w.status) && !w.accountingApplied)
    .reduce((s, w) => s + w.withdrawalAmount, 0);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function run() {
  // BANK lifecycle
  {
    const wallet = createWallet();
    const w = requestWithdrawal(wallet, 2000, 0);
    assert(wallet.balanceAmount === 3000, "bank request balance");
    assert(wallet.pendingAmount === 2000, "bank request pending");
    startProcessing(w);
    assert(wallet.pendingAmount === 2000, "processing keeps pending");
    assert(complete(wallet, w) === "ok", "complete ok");
    assert(wallet.pendingAmount === 0, "complete pending");
    assert(wallet.paidAmount === 2000, "complete paid");
    assert(wallet.totalAmount === 5000, "totalAmount untouched");
    assert(complete(wallet, w) === "alreadySettled_or_invalid", "idempotent complete");
    assert(wallet.paidAmount === 2000, "no double paid");
  }

  // ONLINE with fee
  {
    const wallet = createWallet();
    const w = requestWithdrawal(wallet, 1000, 10); // net 990
    assert(wallet.balanceAmount === 4000, "online balance -= requested");
    assert(wallet.pendingAmount === 990, "online pending += net");
    startProcessing(w);
    assert(wallet.pendingAmount === 990, "online processing pending");
    complete(wallet, w);
    assert(wallet.pendingAmount === 0 && wallet.paidAmount === 990, "online complete");
  }

  // Reject PENDING
  {
    const wallet = createWallet({ balanceAmount: 1000, pendingAmount: 0 });
    const w = requestWithdrawal(wallet, 500, 0);
    assert(reject(wallet, w) === "ok", "reject");
    assert(wallet.balanceAmount === 1000, "reject restores requested");
    assert(wallet.pendingAmount === 0, "reject pending");
    assert(wallet.paidAmount === 0, "reject paid unchanged");
    assert(w.requestedAmount === 500 && w.withdrawalAmount === 500, "amounts preserved");
    assert(reject(wallet, w) === "alreadySettled_or_invalid", "idempotent reject");
    assert(wallet.balanceAmount === 1000, "no double credit");
  }

  // fail then reverse — single restore
  {
    const wallet = createWallet();
    const w = requestWithdrawal(wallet, 800, 0);
    startProcessing(w);
    assert(fail(wallet, w) === "ok", "fail");
    assert(wallet.balanceAmount === 5000 && wallet.pendingAmount === 0, "fail restore");
    assert(reverse(wallet, w) === "ok_status_only", "reverse after fail");
    assert(wallet.balanceAmount === 5000, "no second restore");
    assert(w.status === "REVERSED", "status reversed");
  }

  // reverse from PROCESSING
  {
    const wallet = createWallet();
    const w = requestWithdrawal(wallet, 300, 0);
    startProcessing(w);
    assert(reverse(wallet, w) === "ok_release", "reverse open");
    assert(wallet.balanceAmount === 5000 && wallet.pendingAmount === 0, "reverse release");
  }

  // COMPLETED then reverse undo
  {
    const wallet = createWallet();
    const w = requestWithdrawal(wallet, 400, 0);
    startProcessing(w);
    complete(wallet, w);
    assert(wallet.paidAmount === 400 && wallet.balanceAmount === 4600, "before undo");
    assert(reverse(wallet, w) === "ok_undo", "undo");
    assert(wallet.paidAmount === 0 && wallet.balanceAmount === 5000, "after undo");
    assert(reverse(wallet, w) === "alreadySettled", "idempotent reverse");
  }

  // Multiple withdrawals
  {
    const wallet = createWallet();
    const a = requestWithdrawal(wallet, 500, 0);
    const b = requestWithdrawal(wallet, 300, 0);
    const c = requestWithdrawal(wallet, 200, 0);
    assert(wallet.pendingAmount === 1000, "multi pending sum");
    assert(openPendingSum([a, b, c]) === wallet.pendingAmount, "invariant");
    startProcessing(a);
    assert(wallet.pendingAmount === 1000, "A processing keeps pending");
    complete(wallet, a);
    assert(wallet.pendingAmount === 500 && wallet.paidAmount === 500, "A complete");
    assert(openPendingSum([a, b, c]) === 500, "open sum after A");
    reject(wallet, b);
    assert(wallet.pendingAmount === 200 && wallet.balanceAmount === 4300, "B reject");
    // 5000 -500 -300 -200 +300(reject B) = 4300
    complete(wallet, c);
    assert(wallet.pendingAmount === 0 && wallet.paidAmount === 700, "C complete");
  }

  // Bug: $inc pendingAmount: 0 does nothing
  {
    let pending = 1000;
    pending += 0;
    assert(pending === 1000, "demonstrates old webhook bug");
    pending = clamp(pending - 1000);
    assert(pending === 0, "correct decrement");
  }

  console.log("✅ All withdrawal accounting simulations passed");
}

run();
