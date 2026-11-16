"use strict";

function validId(value) {
  return typeof value === "string" &&
    /^[1-9][0-9]{0,19}$/.test(value) &&
    BigInt(value) <= 18446744073709551615n;
}

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function createConversationHandlers(db) {
  function protect(action) {
    return async (req, res) => {
      res.setHeader("Cache-Control", "no-store");

      if (!req.user) {
        return res.status(401).json({
          message: "Sign in first."
        });
      }

      if (req.user.role !== "manager") {
        return res.status(403).json({
          message: "Manager access is required."
        });
      }

      try {
        return await action(req, res);
      } catch (error) {
        const status = [400, 404].includes(error.status)
          ? error.status : 503;

        return res.status(status).json({
          message: status === 503
            ? "Unable to access conversations."
            : error.message
        });
      }
    };
  }

  async function owned(req) {
    const id = req.params.id;
    if (!validId(id)) fail(400, "Invalid conversation ID.");

    const [rows] = await db.execute(
      `SELECT CAST(id AS CHAR) AS id, title, order_id
       FROM manager_ai_conversations
       WHERE id = ? AND manager_id = ?`,
      [id, req.user.id]
    );

    if (!rows.length) fail(404, "Conversation not found.");
    return rows[0];
  }

  return {
    create: protect(async (req, res) => {
      const orderId = req.body?.order_id ?? null;

      if (orderId !== null && (
        !Number.isSafeInteger(orderId) ||
        orderId <= 0 || orderId > 4294967295
      )) {
        fail(400, "Invalid order ID.");
      }

      if (orderId !== null) {
        const [orders] = await db.execute(
          "SELECT id FROM orders WHERE id = ?",
          [orderId]
        );
        if (!orders.length) fail(404, "Order not found.");
      }

      const [result] = await db.execute(
        `INSERT INTO manager_ai_conversations
          (manager_id, order_id, title)
         VALUES (?, ?, ?)`,
        [req.user.id, orderId, "New chat"]
      );

      const id = result.insertId;
      if (
        (typeof id === "number" && !Number.isSafeInteger(id)) ||
        !validId(String(id))
      ) {
        fail(503, "Unable to access conversations.");
      }

      return res.status(201).json({
        data: {
          id: String(id),
          order_id: orderId,
          title: "New chat"
        }
      });
    }),

    list: protect(async (req, res) => {
      const before = req.query?.before;
      const at = req.query?.at;
      const hasCursor = before !== undefined || at !== undefined;

      if (hasCursor && (
        !validId(before) ||
        typeof at !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(at) ||
        !Number.isFinite(Date.parse(at))
      )) {
        fail(400, "Invalid conversation cursor.");
      }

      const time = hasCursor
        ? at.replace("T", " ").slice(0, -1)
        : null;

      const [rows] = await db.execute(
        `SELECT CAST(id AS CHAR) AS id, title, order_id,
           DATE_FORMAT(
             updated_at, '%Y-%m-%dT%H:%i:%sZ'
           ) AS updated_at
         FROM manager_ai_conversations
         WHERE manager_id = ?
         ${hasCursor
           ? "AND (updated_at < ? OR (updated_at = ? AND id < ?))"
           : ""}
         ORDER BY updated_at DESC, id DESC
         LIMIT 31`,
        hasCursor
          ? [req.user.id, time, time, before]
          : [req.user.id]
      );

      const page = rows.slice(0, 30);
      const last = page[page.length - 1];

      return res.json({
        data: page,
        next_cursor: rows.length > 30
          ? { before: String(last.id), at: last.updated_at }
          : null
      });
    }),

    messages: protect(async (req, res) => {
      const conversation = await owned(req);
      const before = req.query?.before;

      if (before !== undefined && !validId(before)) {
        fail(400, "Invalid message cursor.");
      }

      const [rows] = await db.execute(
        `SELECT CAST(id AS CHAR) AS id,
           order_id, question, answer, source,
           DATE_FORMAT(
             created_at, '%Y-%m-%dT%H:%i:%sZ'
           ) AS created_at
         FROM manager_ai_history
         WHERE manager_id = ? AND conversation_id = ?
         ${before ? "AND id < ?" : ""}
         ORDER BY id DESC LIMIT 31`,
        before
          ? [req.user.id, conversation.id, before]
          : [req.user.id, conversation.id]
      );

      const page = rows.slice(0, 30);

      return res.json({
        conversation,
        data: page.reverse(),
        next_before: rows.length > 30
          ? String(rows[29].id) : null
      });
    }),

    // Route must also use the existing CSRF middleware.
    remove: protect(async (req, res) => {
      const conversation = await owned(req);

      await db.execute(
        `DELETE FROM manager_ai_conversations
         WHERE id = ? AND manager_id = ?`,
        [conversation.id, req.user.id]
      );

      return res.json({
        message: "Conversation deleted."
      });
    })
  };
}

module.exports = { createConversationHandlers };
