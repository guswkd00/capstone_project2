"use strict";

const crypto = require("node:crypto");

function normalizeExternalId(value) {
  if (typeof value !== "string") {
    throw Object.assign(
      new Error("order_id must be a string."),
      { status: 400 }
    );
  }

  const id = value.trim().toUpperCase();

  if (!/^[A-Z0-9_-]{1,128}$/.test(id)) {
    throw Object.assign(
      new Error(
        "order_id must contain 1–128 ASCII letters, " +
        "digits, - or _."
      ),
      { status: 400 }
    );
  }

  return id;
}

function integrationAuth(req, res, next) {
  const secret = process.env.ORDER_IMPORT_TOKEN || "";

  if (secret.length < 32 || secret.length > 512) {
    console.warn(
      JSON.stringify({
        event: "order_import",
        outcome: "unavailable",
      })
    );

    return res.status(503).json({
      outcome: "unavailable",
      message: "Order integration is not configured.",
    });
  }

  const supplied =
    /^Bearer (.{1,512})$/.exec(
      req.headers.authorization || ""
    )?.[1] || "";

  const digest = value =>
    crypto
      .createHash("sha256")
      .update(value)
      .digest();

  const valid = crypto.timingSafeEqual(
    digest(supplied),
    digest(secret)
  );

  if (!valid) {
    console.warn(
      JSON.stringify({
        event: "order_import",
        outcome: "unauthorized",
      })
    );

    return res.status(401).json({
      outcome: "unauthorized",
      message: "Invalid integration credentials.",
    });
  }

  next();
}

function isExternalDuplicate(error) {
  return (
    error.code === "ER_DUP_ENTRY" &&
    /(?:^|[.'`])uq_orders_external_order_id(?:['`]|$)/.test(
      error.sqlMessage || error.message || ""
    )
  );
}

module.exports = {
  normalizeExternalId,
  integrationAuth,
  isExternalDuplicate,
};
