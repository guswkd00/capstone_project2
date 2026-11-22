"use strict";

const express = require("express");
const { randomUUID } = require("node:crypto");

const {
  integrationAuth,
  normalizeExternalId,
  isExternalDuplicate,
} = require("./order-import-policy");

const {
  createFoodOrder,
} = require("./order-service");

function createImportRouter(db) {
  const router = express.Router();

  router.use(integrationAuth);

  router.post("/orders", async (req, res) => {
    let id;

    function log(outcome) {
      const level =
        outcome === "duplicate_ignored"
          ? "warn"
          : "info";

      console[level](
        JSON.stringify({
          event: "order_import",
          order_id: id || null,
          outcome,
        })
      );
    }

    async function duplicate() {
      const [rows] = await db.execute(
        `
          SELECT id, order_code
          FROM orders
          WHERE external_order_id = ?
        `,
        [id]
      );

      if (!rows.length) return false;

      log("duplicate_ignored");

      res.status(200).json({
        outcome: "duplicate_ignored",
        order_id: id,
        data: rows[0],
      });

      return true;
    }

    try {
      id = normalizeExternalId(req.body?.order_id);

      if (await duplicate()) return;

      const source =
        process.env.ORDER_IMPORT_SOURCE ||
        "integration";

      if (!/^[A-Za-z0-9_-]{1,64}$/.test(source)) {
        throw new Error(
          "Invalid integration source configuration."
        );
      }

      const localCode =
        "IMP-" +
        randomUUID()
          .replaceAll("-", "")
          .slice(0, 24);

      const data = await createFoodOrder(
        {
          ...req.body,
          order_code: localCode,
        },
        db,
        {
          externalId: id,
          source,
        }
      );

      log("created");

      return res.status(201).json({
        outcome: "created",
        order_id: id,
        data,
      });
    } catch (error) {
      // The database constraint handles concurrent retries.
      try {
        if (
          isExternalDuplicate(error) &&
          await duplicate()
        ) {
          return;
        }
      } catch {
        // Fall through to the error response.
      }

      const status =
        error.status === 400 ? 400 : 500;

      const outcome =
        status === 400
          ? "invalid_payload"
          : "system_error";

      log(outcome);

      return res.status(status).json({
        outcome,
        message:
          status === 400
            ? error.message
            : "Unable to import the order.",
      });
    }
  });

  return router;
}

module.exports = {
  createImportRouter,
};
