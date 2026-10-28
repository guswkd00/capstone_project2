"use strict";

const express = require("express");

const MAX_ID = 18446744073709551615n;

function validId(value) {
  return typeof value === "string" &&
    /^[1-9][0-9]{0,19}$/.test(value) &&
    BigInt(value) <= MAX_ID;
}

function createManagerNotificationsRouter(pool) {
  const router = express.Router();
  const recentSyncs = new Map();

  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");

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

    next();
  });

  function handle(task) {
    return async (req, res) => {
      try {
        await task(req, res);
      } catch (error) {
        console.error(
          "Manager notifications failed:",
          error.code || error.name
        );

        res.status(503).json({
          message: "Notifications are unavailable. Please try again."
        });
      }
    };
  }

  async function transaction(task) {
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      const result = await task(connection);

      await connection.commit();

      return result;
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original error.
      }

      throw error;
    } finally {
      connection.release();
    }
  }

  function filters(query) {
    const type = query.type || "all";
    const state = query.state || "all";
    const q = query.q || "";
    const before = query.before || null;

    if (
      ![
        "all",
        "overdue_order",
        "wallet_request",
        "driver_message"
      ].includes(type) ||
      !["all", "unread", "read"].includes(state) ||
      typeof q !== "string" ||
      q.length > 100 ||
      (before !== null && !validId(before))
    ) {
      return null;
    }

    return {
      type,
      state,
      q: q.trim(),
      before
    };
  }

  async function list(managerId, filter = {}) {
    return transaction(async connection => {
      const [[counts]] = await connection.execute(
        `SELECT
           COUNT(
             CASE WHEN read_at IS NULL THEN 1 END
           ) AS unread_count,
           CAST(MAX(id) AS CHAR) AS latest_id
         FROM manager_notifications
         WHERE manager_id = ?`,
        [managerId]
      );

      const conditions = ["n.manager_id = ?"];
      const values = [managerId];

      if (filter.type && filter.type !== "all") {
        conditions.push("n.notification_type = ?");
        values.push(filter.type);
      }

      if (filter.state === "unread") {
        conditions.push("n.read_at IS NULL");
      }

      if (filter.state === "read") {
        conditions.push("n.read_at IS NOT NULL");
      }

      if (filter.q) {
        conditions.push(
          "LOCATE(?, CONCAT(n.title, ' ', n.message)) > 0"
        );

        values.push(filter.q);
      }

      if (filter.before) {
        conditions.push("n.id < ?");
        values.push(filter.before);
      }

      const [rows] = await connection.execute(
        `SELECT
           CAST(n.id AS CHAR) AS id,
           n.notification_type,
           n.title,
           n.message,
           n.created_at,
           n.read_at,
           CASE
             WHEN m.id IS NOT NULL THEN
               CONCAT(
                 '/driver-support.html?order=',
                 m.order_id,
                 '&message=',
                 m.id
               )
             ELSE n.target_url
           END AS target_url
         FROM manager_notifications n
         LEFT JOIN driver_order_messages m
           ON n.notification_type = 'driver_message'
           AND n.event_key = CONCAT('driver-message:', m.id)
         WHERE ${conditions.join(" AND ")}
         ORDER BY n.id DESC
         LIMIT 51`,
        values
      );

      return {
        data: rows.slice(0, 50),
        unread_count: Number(counts.unread_count),
        latest_id: counts.latest_id || null,
        next_before: rows.length > 50
          ? rows[49].id
          : null
      };
    });
  }

  async function synchronize(managerId) {
    return transaction(async connection => {
      // Capture the initial backlog without reintroducing old batches
      // after the Manager marks all existing notifications as read.
      await connection.execute(
        `INSERT INTO manager_notifications (
           manager_id,
           event_key,
           notification_type,
           title,
           message,
           target_url
         )
         SELECT
           ?,
           CONCAT(
             'overdue:',
             o.id,
             ':',
             DATE_FORMAT(o.due_at, '%Y%m%d%H%i%s')
           ),
           'overdue_order',
           'Overdue delivery',
           CONCAT(
             'Order ',
             o.order_code,
             ' has passed its delivery deadline and is still open. Review its current status.'
           ),
           CONCAT('/dispatch.html?order=', o.id)
         FROM orders o
         WHERE o.status IN (
           'pending',
           'confirmed',
           'assigned',
           'delivering'
         )
           AND o.due_at < UTC_TIMESTAMP()
           AND NOT EXISTS (
             SELECT 1
             FROM manager_notifications n
             WHERE n.manager_id = ?
               AND n.event_key = CONCAT(
                 'overdue:',
                 o.id,
                 ':',
                 DATE_FORMAT(o.due_at, '%Y%m%d%H%i%s')
               )
           )
         ON DUPLICATE KEY UPDATE
           event_key = VALUES(event_key)`,
        [managerId, managerId]
      );

      await connection.execute(
        `INSERT INTO manager_notifications (
           manager_id,
           event_key,
           notification_type,
           title,
           message,
           target_url
         )
         SELECT
           ?,
           CONCAT('wallet:', r.id),
           'wallet_request',
           'Wallet request awaiting review',
           CONCAT(
             d.driver_code,
             ' submitted a ',
             r.request_type,
             ' request for ',
             r.amount,
             ' VND. Request #',
             r.id,
             ' is awaiting Manager review.'
           ),
           '/driver-support.html'
         FROM driver_wallet_requests r
         JOIN drivers d ON d.id = r.driver_id
         WHERE r.status = 'pending'
           AND NOT EXISTS (
             SELECT 1
             FROM manager_notifications n
             WHERE n.manager_id = ?
               AND n.event_key = CONCAT('wallet:', r.id)
           )
         ON DUPLICATE KEY UPDATE
           event_key = VALUES(event_key)`,
        [managerId, managerId]
      );

      await connection.execute(
        `INSERT INTO manager_notifications (
           manager_id,
           event_key,
           notification_type,
           title,
           message,
           target_url
         )
         SELECT
           ?,
           CONCAT('driver-message:', m.id),
           'driver_message',
           'Driver support message',
           CONCAT(
             'A Driver sent a message about order ',
             o.order_code,
             '. Open Driver Support to view the conversation.'
           ),
           CONCAT(
             '/driver-support.html?order=',
             o.id,
             '&message=',
             m.id
           )
         FROM driver_order_messages m
         JOIN orders o ON o.id = m.order_id
         WHERE m.sender_role = 'driver'
           AND m.created_at >= DATE_SUB(
             UTC_TIMESTAMP(),
             INTERVAL 7 DAY
           )
           AND NOT EXISTS (
             SELECT 1
             FROM manager_notifications n
             WHERE n.manager_id = ?
               AND n.event_key = CONCAT(
                 'driver-message:',
                 m.id
               )
           )
         ON DUPLICATE KEY UPDATE
           event_key = VALUES(event_key)`,
        [managerId, managerId]
      );
    });
  }

  router.get("/", handle(async (req, res) => {
    const filter = filters(req.query);

    if (!filter) {
      return res.status(400).json({
        message: "Invalid notification filters."
      });
    }

    res.json(await list(req.user.id, filter));
  }));

  router.post("/sync", handle(async (req, res) => {
    const filter = filters(req.query);

    if (!filter) {
      return res.status(400).json({
        message: "Invalid notification filters."
      });
    }

    const managerId = req.user.id;
    const now = Date.now();
    const previous = recentSyncs.get(managerId);

    if (!previous || now - previous >= 25000) {
      // Reserve the slot before awaiting to limit concurrent tabs.
      recentSyncs.set(managerId, now);

      for (const [id, timestamp] of recentSyncs) {
        if (now - timestamp > 600000) {
          recentSyncs.delete(id);
        }
      }

      if (recentSyncs.size > 10000) {
        recentSyncs.delete(
          recentSyncs.keys().next().value
        );
      }

      try {
        await synchronize(managerId);
      } catch (error) {
        recentSyncs.delete(managerId);
        throw error;
      }
    }

    res.json(await list(managerId, filter));
  }));

  router.post("/read-all", handle(async (req, res) => {
    const throughId = req.body?.through_id;

    if (!validId(throughId)) {
      return res.status(400).json({
        message: "Invalid notification boundary."
      });
    }

    await pool.execute(
      `UPDATE manager_notifications
       SET read_at = UTC_TIMESTAMP()
       WHERE manager_id = ?
         AND id <= ?
         AND read_at IS NULL`,
      [req.user.id, throughId]
    );

    res.json({
      message: "Notifications marked as read."
    });
  }));

  router.post("/:id/read", handle(async (req, res) => {
    if (!validId(req.params.id)) {
      return res.status(400).json({
        message: "Invalid notification ID."
      });
    }

    const [result] = await pool.execute(
      `UPDATE manager_notifications
       SET read_at = COALESCE(read_at, UTC_TIMESTAMP())
       WHERE id = ?
         AND manager_id = ?`,
      [req.params.id, req.user.id]
    );

    if (!result.affectedRows) {
      const [rows] = await pool.execute(
        `SELECT id
         FROM manager_notifications
         WHERE id = ?
           AND manager_id = ?`,
        [req.params.id, req.user.id]
      );

      if (!rows.length) {
        return res.status(404).json({
          message: "Notification not found."
        });
      }
    }

    res.json({
      message: "Notification marked as read."
    });
  }));

  return router;
}

module.exports = {
  createManagerNotificationsRouter
};
