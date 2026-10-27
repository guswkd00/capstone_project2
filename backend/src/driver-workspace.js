"use strict";

const express = require("express");

const {
  error,
  integer,
  policy,
  uuid,
} = require("./driver-workspace-policy");

const {
  ensureWallet,
  lockWallet,
  createRequest,
  reviewRequest,
} = require("./driver-wallet-store");

function id(value) {
  if (!/^[1-9]\d*$/.test(String(value))) {
    throw error(400, "Invalid record ID.");
  }

  return integer(
    Number(value),
    1,
    Number.MAX_SAFE_INTEGER,
    "Record ID"
  );
}

function createWorkspaceRouter(
  pool,
  { manager = false } = {}
) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");

    if (!req.user) {
      return res.status(401).json({
        message: "Please sign in.",
      });
    }

    if (
      req.user.role !== (manager ? "manager" : "driver") ||
      (!manager && !req.driver)
    ) {
      return res.status(403).json({
        message:
          "This workspace is not available to your account.",
      });
    }

    next();
  });

  function handle(fn) {
    return async (req, res) => {
      try {
        await fn(req, res);
      } catch (e) {
        if (!e.status) {
          console.error(
            "Driver workspace failed:",
            e.code || e.name
          );
        }

        res.status(e.status || 500).json({
          message: e.status
            ? e.message
            : "Unable to process this request. Please retry.",
        });
      }
    };
  }

  async function transaction(fn) {
    const db = await pool.getConnection();

    try {
      await db.beginTransaction();

      const result = await fn(db);

      await db.commit();

      return result;
    } catch (e) {
      await db.rollback();
      throw e;
    } finally {
      db.release();
    }
  }

  async function lockDriver(db, req) {
    const [rows] = await db.execute(
      `SELECT id
       FROM drivers
       WHERE id = ?
         AND user_id = ?
       FOR UPDATE`,
      [req.driver.id, req.user.id]
    );

    if (!rows.length) {
      throw error(
        403,
        "Your driver account is no longer linked."
      );
    }
  }

  if (!manager) {
    router.get(
      "/wallet",
      handle(async (req, res) => {
        await ensureWallet(pool, req.driver.id);

        const [[wallet]] = await pool.execute(
          `SELECT *
           FROM driver_wallets
           WHERE driver_id = ?`,
          [req.driver.id]
        );

        const [entries] = await pool.execute(
          `SELECT *
           FROM driver_wallet_entries
           WHERE driver_id = ?
           ORDER BY id DESC
           LIMIT 50`,
          [req.driver.id]
        );

        const [requests] = await pool.execute(
          `SELECT *
           FROM driver_wallet_requests
           WHERE driver_id = ?
           ORDER BY id DESC
           LIMIT 50`,
          [req.driver.id]
        );

        const [[daily]] = await pool.execute(
          `SELECT COALESCE(SUM(cash_delta), 0) AS bonus
           FROM driver_wallet_entries
           WHERE driver_id = ?
             AND entry_type = 'reward_bonus'
             AND DATE(
               DATE_ADD(created_at, INTERVAL 7 HOUR)
             ) = DATE(
               DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR)
             )`,
          [req.driver.id]
        );

        const [[metrics]] = await pool.execute(
          `SELECT
             SUM(
               status IN ('assigned', 'delivering')
             ) AS active,
             SUM(status = 'completed') AS completed,
             COALESCE(
               SUM(
                 CASE
                   WHEN status IN ('assigned', 'delivering')
                   THEN cod_amount
                   ELSE 0
                 END
               ),
               0
             ) AS cod_to_collect
           FROM orders
           WHERE driver_id = ?`,
          [req.driver.id]
        );

        res.json({
          data: {
            ...wallet,
            available_cash:
              Number(wallet.cash_balance) -
              Number(wallet.reserved_cash),
            max_delivery_km: Math.min(
              Number(wallet.max_delivery_km),
              policy().max_delivery_km
            ),
          },
          entries,
          requests,
          rewards: {
            ...policy(),
            daily_bonus: Number(daily.bonus),
          },
          metrics,
          note:
            "Internal ledger. Bank transfers require Manager confirmation; COD collections are not personal earnings.",
        });
      })
    );

    router.put(
      "/preferences",
      handle(async (req, res) => {
        const max = req.body?.max_delivery_km;

        if (
          typeof max !== "number" ||
          !Number.isFinite(max) ||
          max < 1 ||
          max > policy().max_delivery_km
        ) {
          throw error(
            400,
            `Distance must be between 1 and ${policy().max_delivery_km} km.`
          );
        }

        await transaction(async (db) => {
          await lockDriver(db, req);
          await lockWallet(db, req.driver.id);

          await db.execute(
            `UPDATE driver_wallets
             SET max_delivery_km = ?
             WHERE driver_id = ?`,
            [max, req.driver.id]
          );
        });

        res.json({
          message: "Distance preference saved.",
          data: {
            max_delivery_km: max,
          },
        });
      })
    );

    router.post(
      "/wallet/requests",
      handle(async (req, res) => {
        const data = await transaction(async (db) => {
          await lockDriver(db, req);

          return createRequest(
            db,
            req.driver.id,
            req.body
          );
        });

        res.status(201).json({
          data,
          message:
            "Request saved for Manager review. No bank transfer has been performed.",
        });
      })
    );
  } else {
    router.get(
      "/wallet/requests",
      handle(async (req, res) => {
        const [data] = await pool.query(
          `SELECT
             r.*,
             d.full_name,
             d.driver_code
           FROM driver_wallet_requests r
           JOIN drivers d ON d.id = r.driver_id
           ORDER BY
             (r.status = 'pending') DESC,
             r.id DESC
           LIMIT 100`
        );

        res.json({ data });
      })
    );

    router.post(
      "/wallet/requests/:id/review",
      handle(async (req, res) => {
        const requestId = id(req.params.id);

        const data = await transaction(async (db) => {
          const [lookup] = await db.execute(
            `SELECT driver_id
             FROM driver_wallet_requests
             WHERE id = ?`,
            [requestId]
          );

          if (!lookup.length) {
            throw error(404, "Request not found.");
          }

          await db.execute(
            `SELECT id
             FROM drivers
             WHERE id = ?
             FOR UPDATE`,
            [lookup[0].driver_id]
          );

          await lockWallet(db, lookup[0].driver_id);

          const [[request]] = await db.execute(
            `SELECT *
             FROM driver_wallet_requests
             WHERE id = ?
             FOR UPDATE`,
            [requestId]
          );

          return reviewRequest(
            db,
            request,
            req.user.id,
            req.body
          );
        });

        res.json({
          data,
          message:
            "Review recorded. This system does not initiate a bank transfer.",
        });
      })
    );

    router.get(
      "/orders",
      handle(async (req, res) => {
        const [data] = await pool.query(
          `SELECT
             o.id,
             o.order_code,
             d.full_name AS driver_name
           FROM orders o
           JOIN drivers d ON d.id = o.driver_id
           ORDER BY o.id DESC
           LIMIT 200`
        );

        res.json({ data });
      })
    );
  }

  async function authorizedOrder(
    db,
    req,
    lock = false
  ) {
    const orderId = id(req.params.id);

    const [rows] = await db.execute(
      `SELECT
         id,
         driver_id,
         assigned_at,
         status
       FROM orders
       WHERE id = ?
       ${lock ? "FOR UPDATE" : ""}`,
      [orderId]
    );

    if (
      !rows.length ||
      (
        !manager &&
        Number(rows[0].driver_id) !== Number(req.driver.id)
      )
    ) {
      throw error(404, "Delivery not found.");
    }

    return rows[0];
  }

  router.get(
    "/orders/:id/messages",
    handle(async (req, res) => {
      // Prevent reassignment between authorization and retrieval.
      const data = await transaction(async (db) => {
        if (!manager) {
          await lockDriver(db, req);
        }

        const order = await authorizedOrder(
          db,
          req,
          true
        );

        const before =
          req.query.before === undefined
            ? Number.MAX_SAFE_INTEGER
            : id(req.query.before);

        const [rows] = await db.execute(
          `SELECT
             m.id,
             m.sender_role,
             m.message_text,
             m.created_at,
             u.full_name AS sender_name
           FROM driver_order_messages m
           JOIN users u ON u.id = m.sender_id
           WHERE m.order_id = ?
             AND m.id < ?
             ${
               manager
                 ? ""
                 : "AND m.created_at >= COALESCE(?, m.created_at)"
             }
           ORDER BY m.id DESC
           LIMIT 51`,
          manager
            ? [order.id, before]
            : [order.id, before, order.assigned_at]
        );

        const more = rows.length > 50;

        return {
          messages: rows.slice(0, 50).reverse(),
          next_cursor: more
            ? String(rows[49].id)
            : null,
        };
      });

      res.json({
        data: data.messages,
        next_cursor: data.next_cursor,
        channel:
          "Manager support; external customer messaging is not connected.",
      });
    })
  );

  router.post(
    "/orders/:id/messages",
    handle(async (req, res) => {
      const text = req.body?.message_text;

      if (
        typeof text !== "string" ||
        !text.trim() ||
        text.trim().length > 1000
      ) {
        throw error(
          400,
          "Message must contain 1–1000 characters."
        );
      }

      uuid(req.body.message_key);

      const data = await transaction(async (db) => {
        if (!manager) {
          await lockDriver(db, req);
        }

        const order = await authorizedOrder(
          db,
          req,
          true
        );

        const [existing] = await db.execute(
          `SELECT
             id,
             order_id,
             message_text
           FROM driver_order_messages
           WHERE sender_id = ?
             AND message_key = ?`,
          [req.user.id, req.body.message_key]
        );

        if (existing.length) {
          if (
            Number(existing[0].order_id) !== Number(order.id) ||
            existing[0].message_text !== text.trim()
          ) {
            throw error(
              409,
              "Message key already used."
            );
          }

          return {
            id: existing[0].id,
            status: "saved",
          };
        }

        if (
          ["completed", "failed", "cancelled"].includes(
            order.status
          )
        ) {
          throw error(
            409,
            "Messaging is read-only for closed deliveries."
          );
        }

        const [[count]] = await db.execute(
          `SELECT COUNT(*) AS total
           FROM driver_order_messages
           WHERE sender_id = ?
             AND created_at >= DATE_SUB(
               UTC_TIMESTAMP(),
               INTERVAL 1 MINUTE
             )`,
          [req.user.id]
        );

        if (Number(count.total) >= 20) {
          throw error(
            429,
            "Too many messages. Please wait one minute."
          );
        }

        const [result] = await db.execute(
          `INSERT INTO driver_order_messages (
             order_id,
             sender_id,
             sender_role,
             message_key,
             message_text
           ) VALUES (?, ?, ?, ?, ?)`,
          [
            order.id,
            req.user.id,
            req.user.role,
            req.body.message_key,
            text.trim(),
          ]
        );

        return {
          id: result.insertId,
          status: "saved",
        };
      });

      res.status(201).json({ data });
    })
  );

  return router;
}

module.exports = {
  createWorkspaceRouter,
};
