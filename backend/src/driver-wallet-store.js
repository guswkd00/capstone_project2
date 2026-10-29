"use strict";

const {
  error,
  policy,
  rewardFor,
  validateRequest,
} = require("./driver-workspace-policy");

async function ensureWallet(db, driverId) {
  await db.execute(
    `INSERT IGNORE INTO driver_wallets (
      driver_id,
      max_delivery_km
    ) VALUES (?, ?)`,
    [driverId, policy().max_delivery_km]
  );
}

async function lockWallet(db, driverId) {
  await ensureWallet(db, driverId);

  const [rows] = await db.execute(
    `SELECT *
     FROM driver_wallets
     WHERE driver_id = ?
     FOR UPDATE`,
    [driverId]
  );

  return rows[0];
}

// Called inside the delivery completion transaction.
async function creditCompletion(db, driverId, order) {
  const wallet = await lockWallet(db, driverId);

  const [prior] = await db.execute(
    `SELECT id
     FROM driver_wallet_entries
     WHERE driver_id = ?
       AND event_key = ?`,
    [driverId, `delivery:${order.id}`]
  );

  if (prior.length) return;

  const fee = Number(order.delivery_fee);

  if (!Number.isSafeInteger(fee) || fee < 0) {
    throw error(
      409,
      "Delivery fee must be a non-negative whole VND amount."
    );
  }

  const reward = rewardFor(Number(wallet.points));

  await db.execute(
    `INSERT INTO driver_wallet_entries (
      driver_id,
      event_key,
      entry_type,
      cash_delta,
      points_delta,
      description
    ) VALUES (?, ?, 'delivery_fee', ?, ?, ?)`,
    [
      driverId,
      `delivery:${order.id}`,
      fee,
      reward.points,
      `Delivery fee: ${order.order_code}`,
    ]
  );

  if (reward.bonus) {
    await db.execute(
      `INSERT INTO driver_wallet_entries (
        driver_id,
        event_key,
        entry_type,
        cash_delta,
        description
      ) VALUES (?, ?, 'reward_bonus', ?, ?)`,
      [
        driverId,
        `bonus:${order.id}`,
        reward.bonus,
        "Configured reward tier reached",
      ]
    );
  }

  await db.execute(
    `UPDATE driver_wallets
     SET cash_balance = cash_balance + ?,
         points = points + ?
     WHERE driver_id = ?`,
    [fee + reward.bonus, reward.points, driverId]
  );
}

async function createRequest(db, driverId, body) {
  validateRequest(body);

  const wallet = await lockWallet(db, driverId);

  const [existing] = await db.execute(
    `SELECT *
     FROM driver_wallet_requests
     WHERE driver_id = ?
       AND request_key = ?`,
    [driverId, body.request_key]
  );

  if (existing.length) {
    if (
      existing[0].request_type !== body.request_type ||
      Number(existing[0].amount) !== body.amount
    ) {
      throw error(
        409,
        "Request key was already used with different details."
      );
    }

    return existing[0];
  }

  if (body.request_type === "withdrawal") {
    const available =
      Number(wallet.cash_balance) -
      Number(wallet.reserved_cash);

    if (available < body.amount) {
      throw error(
        409,
        "Insufficient available cash balance."
      );
    }

    await db.execute(
      `UPDATE driver_wallets
       SET reserved_cash = reserved_cash + ?
       WHERE driver_id = ?`,
      [body.amount, driverId]
    );
  }

  const [result] = await db.execute(
    `INSERT INTO driver_wallet_requests (
      driver_id,
      request_key,
      request_type,
      amount
    ) VALUES (?, ?, ?, ?)`,
    [
      driverId,
      body.request_key,
      body.request_type,
      body.amount,
    ]
  );

  return {
    id: result.insertId,
    status: "pending",
    request_type: body.request_type,
    amount: body.amount,
    request_key: body.request_key,
  };
}

async function reviewRequest(
  db,
  request,
  managerId,
  body
) {
  if (
    !["approved", "rejected"].includes(body?.status) ||
    typeof body.reference !== "string" ||
    !body.reference.trim() ||
    body.reference.trim().length > 150
  ) {
    throw error(
      400,
      "Review status and a reference/rejection reason (1–150 characters) are required."
    );
  }

  if (request.status !== "pending") {
    if (
      request.status === body.status &&
      request.reference === body.reference.trim()
    ) {
      return request;
    }

    throw error(
      409,
      "This request has already been reviewed."
    );
  }

  const amount = Number(request.amount);

  if (request.request_type === "withdrawal") {
    const [result] = await db.execute(
      `UPDATE driver_wallets
       SET reserved_cash = reserved_cash - ?,
           cash_balance = cash_balance - ?
       WHERE driver_id = ?
         AND reserved_cash >= ?
         AND cash_balance >= ?`,
      [
        amount,
        body.status === "approved" ? amount : 0,
        request.driver_id,
        amount,
        amount,
      ]
    );

    if (!result.affectedRows) {
      throw error(
        409,
        "Wallet reservation is inconsistent."
      );
    }
  } else if (body.status === "approved") {
    await db.execute(
      `UPDATE driver_wallets
       SET deposit_balance = deposit_balance + ?
       WHERE driver_id = ?`,
      [amount, request.driver_id]
    );
  }

  if (body.status === "approved") {
    await db.execute(
      `INSERT INTO driver_wallet_entries (
        driver_id,
        event_key,
        entry_type,
        cash_delta,
        deposit_delta,
        description
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        request.driver_id,
        `request:${request.id}`,
        request.request_type,
        request.request_type === "withdrawal"
          ? -amount
          : 0,
        request.request_type === "topup"
          ? amount
          : 0,
        body.reference.trim(),
      ]
    );
  }

  await db.execute(
    `UPDATE driver_wallet_requests
     SET status = ?,
         reference = ?,
         reviewed_by = ?,
         reviewed_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [
      body.status,
      body.reference.trim(),
      managerId,
      request.id,
    ]
  );

  return {
    id: request.id,
    status: body.status,
  };
}

module.exports = {
  ensureWallet,
  lockWallet,
  creditCompletion,
  createRequest,
  reviewRequest,
};
