const express = require("express");
const { pool } = require("./db");
const { MODEL, recommendDrivers } = require("./dss");

const router = express.Router();

router.get("/:id/recommendations", async (req, res) => {
  const orderId = Number(req.params.id);

  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    return res.status(400).json({
      message: "Invalid order ID.",
    });
  }

  try {
    const [orders] = await pool.execute(
      `
        SELECT
          o.id,
          o.order_code,
          o.customer_name,
          o.delivery_address,
          o.status,
          o.zone_id,
          o.driver_id,
          o.weight_kg,
          o.latitude,
          o.longitude,
          DATE_FORMAT(
            o.due_at,
            '%Y-%m-%d %H:%i:%s'
          ) AS due_at,
          z.name AS service_zone,
          z.active AS zone_active,
          r.name AS restaurant_name,
          r.address AS pickup_address,
          r.phone AS restaurant_phone,
          r.latitude AS pickup_latitude,
          r.longitude AS pickup_longitude
        FROM orders o
        LEFT JOIN zones z ON z.id = o.zone_id
        LEFT JOIN restaurants r
        ON r.id = o.restaurant_id
        AND r.zone_id = o.zone_id
        WHERE o.id = ?
      `,
      [orderId]
    );

    if (orders.length === 0) {
      return res.status(404).json({
        message: "Order not found.",
      });
    }

    const order = orders[0];

    if (!["pending", "confirmed", "assigned"].includes(order.status)) {
      return res.status(409).json({
        message: "Recommendations are only available before delivery starts.",
      });
    }

    if (Number(order.zone_active) !== 1) {
      return res.status(409).json({
        message: "The order requires an active service zone.",
      });
    }

    if (
      order.latitude === null ||
      order.longitude === null ||
      order.due_at === null ||
      order.pickup_latitude === null ||
      order.pickup_longitude === null
    ) {
      return res.status(409).json({
        message: "The order is missing coordinates or a delivery deadline.",
      });
    }

    const [drivers] = await pool.execute(
      `
        SELECT
          d.id,
          d.driver_code,
          d.full_name,
          d.phone,
          d.zone_id,
          d.vehicle_id,
          d.status,
          d.latitude,
          d.longitude,
          z.name AS service_zone,
          z.active AS zone_active,
          v.plate_number,
          v.capacity_kg,
          v.cost_per_km,
          v.status AS vehicle_status,
          DATE_FORMAT(
            v.maintenance_due,
            '%Y-%m-%d'
          ) AS maintenance_due,
          COALESCE(workload.active_orders, 0) AS active_orders,
          COALESCE(workload.active_weight_kg, 0) AS active_weight_kg
        FROM drivers d
        JOIN zones z ON z.id = d.zone_id
        JOIN vehicles v ON v.id = d.vehicle_id
        LEFT JOIN (
          SELECT
            driver_id,
            COUNT(*) AS active_orders,
            SUM(weight_kg) AS active_weight_kg
          FROM orders
          WHERE status IN ('assigned', 'delivering')
            AND id <> ?
          GROUP BY driver_id
        ) workload ON workload.driver_id = d.id
        ORDER BY d.id
      `,
      [orderId]
    );

    const candidates = recommendDrivers(order, drivers);
    const recommended = candidates.find(candidate => candidate.eligible);

    res.json({
      order,
      model: MODEL,
      recommended_driver_id: recommended ? recommended.id : null,
      candidates,
      note: "Distance, ETA and cost are estimates, not live traffic predictions.",
    });
  } catch (error) {
    if (
      error.message ===
      "The order is missing valid dispatch information."
    ) {
      return res.status(409).json({
        message: error.message,
      });
    }

    console.error(
      "Dispatch recommendations failed:",
      error.code || error.message
    );

    res.status(500).json({
      message: "Unable to calculate driver recommendations.",
    });
  }
});
// Approve an assignment or reassign an unstarted order.
router.post("/:id/assign", async (req, res) => {
  const orderId = Number(req.params.id);
  const driverId = Number(req.body?.driver_id);

  if (
    !Number.isSafeInteger(orderId) ||
    orderId <= 0 ||
    !Number.isSafeInteger(driverId) ||
    driverId <= 0
  ) {
    return res.status(400).json({
      message: "Valid order and driver IDs are required.",
    });
  }

  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Serialize assignments and protect the feasibility data.
    await connection.query(
      "SELECT id FROM drivers ORDER BY id FOR UPDATE"
    );

    await connection.query(
      "SELECT id FROM vehicles ORDER BY id FOR UPDATE"
    );

    await connection.query(
      "SELECT id FROM zones ORDER BY id FOR UPDATE"
    );

    const [orders] = await connection.execute(
      `
        SELECT
          o.*,
          DATE_FORMAT(o.due_at, '%Y-%m-%d %H:%i:%s') AS due_at,
          z.active AS zone_active,
          r.name AS restaurant_name,
          r.address AS pickup_address,
          r.phone AS restaurant_phone,
          r.latitude AS pickup_latitude,
          r.longitude AS pickup_longitude
        FROM orders o
        LEFT JOIN zones z ON z.id = o.zone_id
        LEFT JOIN restaurants r
        ON r.id = o.restaurant_id
        AND r.zone_id = o.zone_id
        WHERE o.id = ?
        FOR UPDATE
      `,
      [orderId]
    );

    function assignmentError(status, message) {
      return Object.assign(new Error(message), { status });
    }

    if (!orders.length) {
      throw assignmentError(404, "Order not found.");
    }

    const order = orders[0];

    if (!["pending", "confirmed", "assigned"].includes(order.status)) {
      throw assignmentError(
        409,
        "This order has already started or is closed."
      );
    }

    if (order.status === "assigned" && order.driver_id === driverId) {
      throw assignmentError(
        409,
        "This order is already assigned to this driver."
      );
    }

    if (Number(order.zone_active) !== 1) {
      throw assignmentError(409, "The service zone is inactive.");
    }

    const [drivers] = await connection.execute(
      `
        SELECT
          d.*,
          z.active AS zone_active,
          v.plate_number,
          v.capacity_kg,
          v.cost_per_km,
          v.status AS vehicle_status,
          DATE_FORMAT(v.maintenance_due, '%Y-%m-%d') AS maintenance_due,
          COALESCE(workload.active_orders, 0) AS active_orders,
          COALESCE(workload.active_weight_kg, 0) AS active_weight_kg
        FROM drivers d
        JOIN zones z ON z.id = d.zone_id
        JOIN vehicles v ON v.id = d.vehicle_id
        LEFT JOIN (
          SELECT
            driver_id,
            COUNT(*) AS active_orders,
            SUM(weight_kg) AS active_weight_kg
          FROM orders
          WHERE status IN ('assigned', 'delivering')
            AND id <> ?
          GROUP BY driver_id
        ) workload ON workload.driver_id = d.id
        ORDER BY d.id
      `,
      [orderId]
    );

    const candidates = recommendDrivers(order, drivers);
    const selected = candidates.find(driver => driver.id === driverId);
    const recommended = candidates.find(driver => driver.eligible);

    if (!selected || !selected.eligible) {
      throw assignmentError(
        409,
        selected
          ? selected.reasons.join(" ")
          : "Driver not found."
      );
    }

    const isOverride =
      selected.id !== recommended.id ||
      order.status === "assigned";

    const suppliedReason = typeof req.body.reason === "string"
      ? req.body.reason.trim()
      : "";

    if (
      isOverride &&
      (!suppliedReason || suppliedReason.length > 500)
    ) {
      throw assignmentError(
        400,
        "An override or reassignment requires a reason of 1–500 characters."
      );
    }

    const reason = isOverride
      ? suppliedReason
      : "Approved DSS recommendation";

    const estimatedDistance = Number(
      (selected.pickup_km + selected.delivery_km).toFixed(2)
    );

    const estimatedCost = Math.round(
      estimatedDistance * Number(selected.cost_per_km)
    );

    await connection.execute(
      `
        UPDATE orders
        SET
          driver_id = ?,
          status = 'assigned',
          assigned_at = UTC_TIMESTAMP(),
          estimated_distance_km = ?,
          estimated_delivery_minutes = ?,
          estimated_cost = ?
        WHERE id = ?
      `,
      [
        driverId,
        estimatedDistance,
        selected.eta_minutes,
        estimatedCost,
        orderId,
      ]
    );

    await connection.execute(
      `
        INSERT INTO dispatch_history (
          order_id,
          driver_id,
          vehicle_id,
          decision_type,
          reason,
          score,
          estimated_distance_km,
          estimated_delivery_minutes,
          estimated_cost,
          candidates_snapshot
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        orderId,
        driverId,
        selected.vehicle_id,
        isOverride ? "override" : "recommended",
        reason,
        selected.score,
        estimatedDistance,
        selected.eta_minutes,
        estimatedCost,
        JSON.stringify(candidates),
      ]
    );

    await connection.commit();

    res.json({
      message: "Order assigned successfully.",
      data: {
        order_id: orderId,
        driver_id: driverId,
        driver_name: selected.full_name,
        status: "assigned",
      },
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

    const invalidOrder =
      error.message ===
      "The order is missing valid dispatch information.";

    const status = error.status || (invalidOrder ? 409 : 500);

    if (status === 500) {
      console.error(
        "Assignment failed:",
        error.code || error.message
      );
    }

    res.status(status).json({
      message: status === 500
        ? "Unable to assign the order."
        : error.message,
    });
  } finally {
    if (connection) connection.release();
  }
});
// Get recent dispatch decisions.
router.get("/history", async (req, res) => {
  try {
    const [history] = await pool.execute(`
      SELECT
        h.id,
        h.order_id,
        o.order_code,
        d.driver_code,
        d.full_name AS driver_name,
        v.plate_number,
        h.decision_type,
        h.reason,
        h.score,
        h.estimated_distance_km,
        h.estimated_delivery_minutes,
        h.estimated_cost,
        h.created_at
      FROM dispatch_history h
      JOIN orders o ON o.id = h.order_id
      JOIN drivers d ON d.id = h.driver_id
      JOIN vehicles v ON v.id = h.vehicle_id
      ORDER BY h.id DESC
      LIMIT 200
    `);

    res.json({ data: history });
  } catch (error) {
    console.error("Dispatch history query failed:", error.code);

    res.status(500).json({
      message: "Unable to retrieve dispatch history.",
    });
  }
});
// Manager-only delivery tracking.
// Authentication and Manager access are enforced in server.js.
router.get("/:id/tracking", async (req, res) => {
  const orderId = Number(req.params.id);

  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    return res.status(400).json({
      message: "Invalid order ID."
    });
  }

  try {
    const [rows] = await pool.execute(
      `
        SELECT
          o.id,
          o.order_code,
          o.customer_name,
          o.status,
          o.driver_id,
          o.delivery_address,
          o.latitude,
          o.longitude,
          o.restaurant_arrived_at,
          o.picked_up_at,
          o.delivered_at,

          r.name AS restaurant_name,
          r.latitude AS pickup_latitude,
          r.longitude AS pickup_longitude,

          d.full_name AS driver_name,
          d.driver_code,
          d.latitude AS driver_latitude,
          d.longitude AS driver_longitude,
          d.location_accuracy_m,

          DATE_FORMAT(
            d.location_updated_at,
            '%Y-%m-%dT%H:%i:%sZ'
          ) AS location_updated_at,

          v.plate_number

        FROM orders o

        LEFT JOIN restaurants r
          ON r.id = o.restaurant_id

        LEFT JOIN drivers d
          ON d.id = o.driver_id

        LEFT JOIN vehicles v
          ON v.id = d.vehicle_id

        WHERE o.id = ?
      `,
      [orderId]
    );

    if (!rows.length) {
      return res.status(404).json({
        message: "Order not found."
      });
    }

    const row = rows[0];

    const phase = row.status === "delivering"
      ? row.picked_up_at
        ? "to_customer"
        : row.restaurant_arrived_at
          ? "at_restaurant"
          : "to_restaurant"
      : row.status;

    res.set("Cache-Control", "no-store");

    res.json({
      order: {
        id: row.id,
        order_code: row.order_code,
        customer_name: row.customer_name,
        status: row.status,
        driver_id: row.driver_id,
        delivery_address: row.delivery_address,
        latitude: row.latitude,
        longitude: row.longitude,
        restaurant_name: row.restaurant_name,
        pickup_latitude: row.pickup_latitude,
        pickup_longitude: row.pickup_longitude
      },

      driver: row.driver_id ? {
        id: row.driver_id,
        full_name: row.driver_name,
        driver_code: row.driver_code,
        plate_number: row.plate_number,
        latitude: row.driver_latitude,
        longitude: row.driver_longitude,
        location_updated_at: row.location_updated_at,
        location_accuracy_m: row.location_accuracy_m
      } : null,

      phase,
      server_time: new Date().toISOString()
    });
  } catch (error) {
    console.error(
      "Delivery tracking failed:",
      error.code || error.name
    );

    res.status(500).json({
      message: "Unable to load delivery tracking."
    });
  }
});
module.exports = router;
