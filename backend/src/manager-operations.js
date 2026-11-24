"use strict";

const express = require("express");

function freshnessSeconds() {
  const value = Number(
    process.env.GPS_FRESHNESS_SECONDS || 60
  );

  if (
    !Number.isInteger(value) ||
    value < 15 ||
    value > 300
  ) {
    throw new Error(
      "GPS_FRESHNESS_SECONDS must be 15–300."
    );
  }

  return value;
}

function operationState(driver) {
  if (Number(driver.delivering_orders) > 0) {
    return "Delivering";
  }

  if (
    driver.status === "available" &&
    Number(driver.active_orders) === 0
  ) {
    return "Idle";
  }

  return driver.status === "available"
    ? "Online"
    : "Offline";
}

function createManagerOperationsRouter(db) {
  const router = express.Router();

  // Server middleware also enforces authentication and CSRF.
  router.use((req, res, next) => {
    if (req.user?.role !== "manager") {
      return res.status(403).json({
        message: "Manager access required.",
      });
    }

    next();
  });

  router.get("/zone-summary", async (req, res, next) => {
    try {
      const [zones] = await db.query(`
        SELECT
          z.id,
          z.code,
          z.name,
          z.active,
          COUNT(d.id) AS total_drivers,
          COALESCE(
            SUM(d.status = 'available'),
            0
          ) AS on_duty_drivers

        FROM zones z

        LEFT JOIN drivers d
          ON d.zone_id = z.id

        GROUP BY
          z.id,
          z.code,
          z.name,
          z.active

        ORDER BY z.name
      `);

      const [[unassigned]] = await db.query(`
        SELECT COUNT(*) AS count
        FROM drivers
        WHERE zone_id IS NULL
          OR zone_id NOT IN (
            SELECT id FROM zones
          )
      `);

      return res.json({
        data: zones,
        unassigned_drivers: Number(unassigned.count),

        definition:
          "On duty = driver status available, " +
          "independently of GPS sharing. " +
          "Assigned deliveries remain unchanged " +
          "after a zone transfer.",
      });
    } catch (error) {
      next(error);
    }
  });

  router.put(
    "/drivers/:id/zone",
    async (req, res, next) => {
      const id = Number(req.params.id);
      const zone = req.body?.zone_id;

      if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        !Number.isSafeInteger(zone) ||
        zone <= 0
      ) {
        return res.status(400).json({
          message:
            "Valid driver and zone IDs are required.",
        });
      }

      let connection;

      try {
        connection = await db.getConnection();

        await connection.beginTransaction();

        const [drivers] = await connection.execute(
          `
            SELECT id
            FROM drivers
            WHERE id = ?
            FOR UPDATE
          `,
          [id]
        );

        if (!drivers.length) {
          await connection.rollback();

          return res.status(404).json({
            message: "Driver not found.",
          });
        }

        const [zones] = await connection.execute(
          `
            SELECT id
            FROM zones
            WHERE id = ?
              AND active = 1
            FOR UPDATE
          `,
          [zone]
        );

        if (!zones.length) {
          await connection.rollback();

          return res.status(400).json({
            message: "The zone is missing or inactive.",
          });
        }

        await connection.execute(
          `
            UPDATE drivers
            SET zone_id = ?
            WHERE id = ?
          `,
          [zone, id]
        );

        await connection.commit();

        return res.json({
          data: {
            id,
            zone_id: zone,
          },

          message:
            "Operating zone updated. " +
            "Existing assignments are retained; " +
            "the new zone applies to future recommendations.",
        });
      } catch (error) {
        if (connection) {
          try {
            await connection.rollback();
          } catch {
            // Preserve the original failure.
          }
        }

        next(error);
      } finally {
        connection?.release();
      }
    }
  );

  router.get("/tracking", async (req, res, next) => {
    res.set("Cache-Control", "no-store");

    try {
      const ttl = freshnessSeconds();

      const [rows] = await db.execute(
        `
          SELECT
            d.id,
            d.driver_code,
            d.full_name,
            d.status,
            d.zone_id,
            z.name AS service_zone,
            d.latitude,
            d.longitude,
            d.location_accuracy_m,

            DATE_FORMAT(
              d.location_updated_at,
              '%Y-%m-%dT%H:%i:%sZ'
            ) AS location_updated_at,

            COALESCE(
              w.active_orders,
              0
            ) AS active_orders,

            COALESCE(
              w.delivering_orders,
              0
            ) AS delivering_orders

          FROM drivers d

          LEFT JOIN zones z
            ON z.id = d.zone_id

          LEFT JOIN (
            SELECT
              driver_id,
              COUNT(*) AS active_orders,
              SUM(
                status = 'delivering'
              ) AS delivering_orders

            FROM orders

            WHERE status IN (
              'assigned',
              'delivering'
            )

            GROUP BY driver_id
          ) w ON w.driver_id = d.id

          WHERE d.gps_sharing_enabled = 1
            AND d.gps_session_token IS NOT NULL
            AND d.gps_location_token = d.gps_session_token

            AND d.location_updated_at >= DATE_SUB(
              UTC_TIMESTAMP(),
              INTERVAL ? SECOND
            )

            AND d.location_updated_at <= UTC_TIMESTAMP()

            AND d.latitude BETWEEN -90 AND 90
            AND d.longitude BETWEEN -180 AND 180

          ORDER BY d.id
        `,
        [ttl]
      );

      return res.json({
        data: rows.map(driver => ({
          ...driver,
          operational_state: operationState(driver),
          on_duty: driver.status === "available",
        })),

        server_time: new Date().toISOString(),

        freshness_seconds: ttl,

        definition:
          "Priority: Delivering (in-progress orders), " +
          "Idle (available with no active orders), " +
          "Online (available with assigned orders), " +
          "Offline. GPS freshness is separate " +
          "from operational status.",
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  createManagerOperationsRouter,
  freshnessSeconds,
  operationState,
};
