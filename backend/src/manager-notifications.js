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
      return res.status(401).json({ message: "Sign in first." });
    }

    if (req.user.role !== "manager") {
      return res.status(403).json({ message: "Manager access is required." });
    }

    next();
  });

  function handle(task) {
    return async (req, res) => {
      try {
        await task(req, res);
      } catch (error) {
        console.error("Manager notifications failed:", error.code || error.name);
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

  async function list(managerId, before = null) {
    return transaction(async connection => {
      const [[counts]] = await connection.execute(
        `SELECT COUNT(*) AS unread_count
         FROM manager_notifications
         WHERE manager_id = ? AND read_at IS NULL`,
        [managerId]
      );

      const [rows] = await connection.execute(
        `SELECT
           CAST(id AS CHAR) AS id,
           notification_type, title, message, target_url,
           created_at, read_at
         FROM manager_notifications
         WHERE manager_id = ?
           ${before ? "AND id < ?" : ""}
         ORDER BY id DESC
         LIMIT 51`,
        before ? [managerId, before] : [managerId]
      );

      return {
        data: rows.slice(0, 50),
        unread_count: Number(counts.unread_count),
        next_before: rows.length > 50 ? rows[49].id : null
      };
    });
  }

  async function synchronize(managerId) {
    return transaction(async connection => {
      const [orders] = await connection.execute(
        `SELECT o.id, o.order_code,
           CONCAT('overdue:', o.id, ':',
             DATE_FORMAT(o.due_at, '%Y%m%d%H%i%s')) AS event_key
         FROM orders o
         WHERE o.status IN ('pending','confirmed','assigned','delivering')
           AND o.due_at < UTC_TIMESTAMP()
           AND NOT EXISTS (
             SELECT 1 FROM manager_notifications n
             WHERE n.manager_id = ?
               AND n.event_key = CONCAT('overdue:', o.id, ':',
                 DATE_FORMAT(o.due_at, '%Y%m%d%H%i%s'))
           )
         ORDER BY o.due_at, o.id
         LIMIT 100`,
        [managerId]
      );

      const [requests] = await connection.execute(
        `SELECT r.id, r.request_type, r.amount, d.driver_code,
           CONCAT('wallet:', r.id) AS event_key
         FROM driver_wallet_requests r
         JOIN drivers d ON d.id = r.driver_id
         WHERE r.status = 'pending'
           AND NOT EXISTS (
             SELECT 1 FROM manager_notifications n
             WHERE n.manager_id = ?
               AND n.event_key = CONCAT('wallet:', r.id)
           )
         ORDER BY r.id
         LIMIT 100`,
        [managerId]
      );

      const [messages] = await connection.execute(
        `SELECT m.id, o.order_code,
           CONCAT('driver-message:', m.id) AS event_key
         FROM driver_order_messages m
         JOIN orders o ON o.id = m.order_id
         WHERE m.sender_role = 'driver'
           AND m.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
           AND NOT EXISTS (
             SELECT 1 FROM manager_notifications n
             WHERE n.manager_id = ?
               AND n.event_key = CONCAT('driver-message:', m.id)
           )
         ORDER BY m.id
         LIMIT 100`,
        [managerId]
      );

      const notifications = [
        ...orders.map(order => ({
          event_key: order.event_key,
          type: "overdue_order",
          title: "Overdue delivery",
          message: `Order ${order.order_code} has passed its delivery deadline and is still open. Review its current status.`,
          url: `/dispatch.html?order=${order.id}`
        })),
        ...requests.map(request => ({
          event_key: request.event_key,
          type: "wallet_request",
          title: "Wallet request awaiting review",
          message: `${request.driver_code} submitted a ${request.request_type} request for ${Number(request.amount).toLocaleString("en-US")} VND. Request #${request.id} is awaiting Manager review.`,
          url: "/driver-support.html"
        })),
        ...messages.map(message => ({
          event_key: message.event_key,
          type: "driver_message",
          title: "Driver support message",
          message: `A Driver sent a message about order ${message.order_code}. Open Driver Support to view the conversation.`,
          url: "/driver-support.html"
        }))
      ];

      if (notifications.length) {
        const placeholders = notifications.map(() => "(?, ?, ?, ?, ?, ?)");
        const values = notifications.flatMap(item => [
          managerId, item.event_key, item.type,
          item.title, item.message, item.url
        ]);

        await connection.execute(
          `INSERT INTO manager_notifications (
             manager_id, event_key, notification_type,
             title, message, target_url
           ) VALUES ${placeholders.join(", ")}
           ON DUPLICATE KEY UPDATE id = id`,
          values
        );
      }
    });
  }

  router.get("/", handle(async (req, res) => {
    const before = req.query.before;

    if (before !== undefined && !validId(before)) {
      return res.status(400).json({ message: "Invalid notification cursor." });
    }

    res.json(await list(req.user.id, before || null));
  }));

  router.post("/sync", handle(async (req, res) => {
    const managerId = req.user.id;
    const now = Date.now();
    const previous = recentSyncs.get(managerId);

    if (!previous || now - previous >= 25000) {
      // Reserve the slot before awaiting to limit concurrent browser tabs.
      recentSyncs.set(managerId, now);

      for (const [id, timestamp] of recentSyncs) {
        if (now - timestamp > 600000) recentSyncs.delete(id);
      }
      if (recentSyncs.size > 10000) {
        recentSyncs.delete(recentSyncs.keys().next().value);
      }

      try {
        await synchronize(managerId);
      } catch (error) {
        recentSyncs.delete(managerId);
        throw error;
      }
    }

    res.json(await list(managerId));
  }));

  router.post("/read-all", handle(async (req, res) => {
    const throughId = req.body?.through_id;

    if (!validId(throughId)) {
      return res.status(400).json({ message: "Invalid notification boundary." });
    }

    await pool.execute(
      `UPDATE manager_notifications
       SET read_at = UTC_TIMESTAMP()
       WHERE manager_id = ? AND id <= ? AND read_at IS NULL`,
      [req.user.id, throughId]
    );

    res.json({ message: "Notifications marked as read." });
  }));

  router.post("/:id/read", handle(async (req, res) => {
    if (!validId(req.params.id)) {
      return res.status(400).json({ message: "Invalid notification ID." });
    }

    const [result] = await pool.execute(
      `UPDATE manager_notifications
       SET read_at = COALESCE(read_at, UTC_TIMESTAMP())
       WHERE id = ? AND manager_id = ?`,
      [req.params.id, req.user.id]
    );

    if (!result.affectedRows) {
      const [rows] = await pool.execute(
        `SELECT id FROM manager_notifications
         WHERE id = ? AND manager_id = ?`,
        [req.params.id, req.user.id]
      );

      if (!rows.length) {
        return res.status(404).json({ message: "Notification not found." });
      }
    }

    res.json({ message: "Notification marked as read." });
  }));

  return router;
}

module.exports = { createManagerNotificationsRouter };
