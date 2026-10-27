const express = require("express");
const { pool } = require("./db");

const router = express.Router();

function apiError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validId(value) {
  const id = Number(value);

  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function requiredText(value, label, maxLength = 500) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maxLength
  ) {
    throw apiError(
      400,
      `${label} must contain 1–${maxLength} characters.`
    );
  }

  return value.trim();
}

function deliveryPhase(order) {
  if (order.status === "assigned") return "assigned";

  if (order.status === "delivering") {
    if (order.picked_up_at) return "to_customer";
    if (order.restaurant_arrived_at) return "at_restaurant";

    return "to_restaurant";
  }

  return order.status;
}

function validCoordinates(latitude, longitude) {
  if (latitude == null || longitude == null) return false;

  const lat = Number(latitude);
  const lng = Number(longitude);

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

// Only a signed-in driver can use these endpoints.
// requireLogin and CSRF protection are mounted in server.js.
router.use(async (req, res, next) => {
  if (!req.user || req.user.role !== "driver") {
    return res.status(403).json({
      message: "A driver account is required.",
    });
  }

  try {
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
          v.plate_number,
          v.vehicle_type,
          v.capacity_kg,
          v.status AS vehicle_status
        FROM drivers d
        LEFT JOIN zones z ON z.id = d.zone_id
        LEFT JOIN vehicles v ON v.id = d.vehicle_id
        WHERE d.user_id = ?
        LIMIT 1
      `,
      [req.user.id]
    );

    if (!drivers.length) {
      return res.status(403).json({
        message: "This account is not linked to a driver.",
      });
    }

    req.driver = drivers[0];
    next();
  } catch (error) {
    console.error("Driver account lookup failed:", error.code);

    res.status(500).json({
      message: "Unable to retrieve your driver profile.",
    });
  }
});

// Get the current driver's profile.
// Update the authenticated driver's own GPS position.
router.post("/location", async (req, res) => {
  const {
    latitude,
    longitude,
    accuracy_m
  } = req.body || {};

  const valid =
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    typeof accuracy_m === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Number.isFinite(accuracy_m) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180 &&
    accuracy_m >= 0 &&
    accuracy_m <= 10000;

  if (!valid) {
    return res.status(400).json({
      message:
        "Provide valid GPS coordinates and accuracy from 0 to 10,000 metres."
    });
  }

  try {
    const [result] = await pool.execute(
      `
        UPDATE drivers
        SET latitude = ?,
            longitude = ?,
            location_accuracy_m = ?,
            location_updated_at = UTC_TIMESTAMP()
        WHERE id = ?
          AND user_id = ?
      `,
      [
        latitude,
        longitude,
        Math.round(accuracy_m),
        req.driver.id,
        req.user.id
      ]
    );

    if (!result.affectedRows) {
      return res.status(403).json({
        message: "Your driver account is no longer linked."
      });
    }

    res.set("Cache-Control", "no-store");

    res.json({
      message: "GPS location updated.",
      updated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error(
      "Driver GPS update failed:",
      error.code || error.name
    );

    res.status(500).json({
      message: "Unable to save GPS location."
    });
  }
});
router.get("/profile", (req, res) => {
  res.json({ data: req.driver });
});

// Get deliveries belonging to the current driver.
router.get("/orders", async (req, res) => {
  try {
    const [orders] = await pool.execute(
      `
        SELECT
          o.id,
          o.order_code,
          o.customer_name,
          o.delivery_address,
          o.status,
          o.total_amount,
          o.payment_method,
          o.cod_amount,
          o.cod_collected,
          o.due_at,
          o.assigned_at,
          o.started_at,
          o.restaurant_arrived_at,
          o.picked_up_at,
          o.delivered_at,
          r.name AS restaurant_name,
          r.address AS pickup_address
        FROM orders o
        LEFT JOIN restaurants r ON r.id = o.restaurant_id
        WHERE o.driver_id = ?
        ORDER BY
          CASE
            WHEN o.status IN ('assigned', 'delivering') THEN 0
            ELSE 1
          END,
          o.due_at ASC,
          o.id DESC
        LIMIT 200
      `,
      [req.driver.id]
    );

    res.json({
      data: orders.map((order) => ({
        ...order,
        phase: deliveryPhase(order),
      })),
    });
  } catch (error) {
    console.error("Driver deliveries query failed:", error.code);

    res.status(500).json({
      message: "Unable to retrieve your deliveries.",
    });
  }
});

// Get one delivery, including food items and its event timeline.
router.get("/orders/:id", async (req, res) => {
  const orderId = validId(req.params.id);

  if (!orderId) {
    return res.status(400).json({
      message: "Invalid order ID.",
    });
  }

  try {
    const [orders] = await pool.execute(
      `
        SELECT
          o.*,
          r.name AS restaurant_name,
          r.address AS pickup_address,
          r.phone AS restaurant_phone,
          r.latitude AS pickup_latitude,
          r.longitude AS pickup_longitude
        FROM orders o
        LEFT JOIN restaurants r ON r.id = o.restaurant_id
        WHERE o.id = ? AND o.driver_id = ?
        LIMIT 1
      `,
      [orderId, req.driver.id]
    );

    if (!orders.length) {
      return res.status(404).json({
        message: "Delivery not found.",
      });
    }

    const [items] = await pool.execute(
      `
        SELECT
          id,
          item_name,
          quantity,
          unit_price,
          quantity * unit_price AS line_total
        FROM order_items
        WHERE order_id = ?
        ORDER BY id
      `,
      [orderId]
    );

    const [events] = await pool.execute(
      `
        SELECT
          e.id,
          e.event_type,
          e.note,
          e.created_at,
          u.full_name AS actor_name
        FROM order_events e
        LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.order_id = ?
        ORDER BY e.id
      `,
      [orderId]
    );

    res.json({
      data: {
        ...orders[0],
        phase: deliveryPhase(orders[0]),
      },
      items,
      events,
    });
  } catch (error) {
    console.error("Driver delivery details failed:", error.code);

    res.status(500).json({
      message: "Unable to retrieve delivery details.",
    });
  }
});

// Progress:
// assigned -> travelling to restaurant -> arrived -> picked up -> completed.
// A delivery in progress can also be reported as failed.
router.post("/orders/:id/progress", async (req, res) => {
  const orderId = validId(req.params.id);
  const body = req.body;

  if (!orderId) {
    return res.status(400).json({
      message: "Invalid order ID.",
    });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({
      message: "A valid delivery update is required.",
    });
  }

  const actions = ["start", "arrive", "pickup", "complete", "fail"];

  if (!actions.includes(body.action)) {
    return res.status(400).json({
      message: "Invalid delivery action.",
    });
  }

  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Lock the driver first, then the vehicle, then the order.
    const [drivers] = await connection.execute(
      `
        SELECT id, status, vehicle_id
        FROM drivers
        WHERE id = ? AND user_id = ?
        FOR UPDATE
      `,
      [req.driver.id, req.user.id]
    );

    if (!drivers.length) {
      throw apiError(403, "Your driver account is no longer linked.");
    }

    const driver = drivers[0];
    let vehicle = null;

    if (driver.vehicle_id != null) {
      const [vehicles] = await connection.execute(
        `
          SELECT
            id,
            status,
            capacity_kg,
            DATE_FORMAT(
              maintenance_due, '%Y-%m-%d'
            ) AS maintenance_due
          FROM vehicles
          WHERE id = ?
          FOR UPDATE
        `,
        [driver.vehicle_id]
      );

      vehicle = vehicles[0] || null;
    }

    const [orders] = await connection.execute(
      `
        SELECT *
        FROM orders
        WHERE id = ? AND driver_id = ?
        FOR UPDATE
      `,
      [orderId, driver.id]
    );

    if (!orders.length) {
      throw apiError(404, "Delivery not found.");
    }

    const order = orders[0];
    let eventType;
    let note;

    if (body.action === "start") {
      if (order.status !== "assigned" || order.started_at) {
        throw apiError(409, "This delivery cannot be started again.");
      }

      if (driver.status !== "available") {
        throw apiError(409, "Set your driver status to available first.");
      }

      if (!vehicle || vehicle.status !== "available") {
        throw apiError(409, "Your vehicle is not available.");
      }

      const today = new Date().toISOString().slice(0, 10);

      if (
        vehicle.maintenance_due &&
        vehicle.maintenance_due < today
      ) {
        throw apiError(409, "Your vehicle maintenance is overdue.");
      }

      const [workload] = await connection.execute(
        `
          SELECT COALESCE(SUM(weight_kg), 0) AS active_weight_kg
          FROM orders
          WHERE driver_id = ?
            AND status IN ('assigned', 'delivering')
        `,
        [driver.id]
      );

      if (
        Number(workload[0].active_weight_kg) >
        Number(vehicle.capacity_kg)
      ) {
        throw apiError(
          409,
          "Your active deliveries exceed the vehicle capacity."
        );
      }

      if (!order.restaurant_id) {
        throw apiError(409, "This order has no pickup restaurant.");
      }

      const [restaurants] = await connection.execute(
        "SELECT id FROM restaurants WHERE id = ?",
        [order.restaurant_id]
      );

      const [items] = await connection.execute(
        "SELECT id FROM order_items WHERE order_id = ? LIMIT 1",
        [order.id]
      );

      if (!restaurants.length || !items.length) {
        throw apiError(
          409,
          "Restaurant and food item information are required."
        );
      }

      await connection.execute(
        `
          UPDATE orders
          SET status = 'delivering',
              started_at = UTC_TIMESTAMP()
          WHERE id = ?
        `,
        [order.id]
      );

      eventType = "delivery_started";
      note = "Driver started travelling to the restaurant.";
    }

    if (body.action === "arrive") {
      if (
        order.status !== "delivering" ||
        !order.started_at ||
        order.restaurant_arrived_at ||
        order.picked_up_at
      ) {
        throw apiError(
          409,
          "Restaurant arrival cannot be confirmed at this stage."
        );
      }

      const [restaurants] = await connection.execute(
        `
          SELECT latitude, longitude
          FROM restaurants
          WHERE id = ?
        `,
        [order.restaurant_id]
      );

      if (!restaurants.length) {
        throw apiError(409, "Pickup restaurant not found.");
      }

      await connection.execute(
        `
          UPDATE orders
          SET restaurant_arrived_at = UTC_TIMESTAMP()
          WHERE id = ?
        `,
        [order.id]
      );

      const restaurant = restaurants[0];

      eventType = "restaurant_arrived";
      note = "Driver confirmed arrival at the restaurant.";
    }

    if (body.action === "pickup") {
      if (
        order.status !== "delivering" ||
        !order.restaurant_arrived_at ||
        order.picked_up_at
      ) {
        throw apiError(
          409,
          "Food pickup cannot be confirmed at this stage."
        );
      }

      const confirmationCode = requiredText(
        body.order_code,
        "Order code",
        30
      );

      if (confirmationCode !== order.order_code) {
        throw apiError(400, "The order code does not match.");
      }

      await connection.execute(
        `
          UPDATE orders
          SET picked_up_at = UTC_TIMESTAMP()
          WHERE id = ?
        `,
        [order.id]
      );

      eventType = "food_picked_up";
      note = "Driver confirmed food pickup and checked the order code.";
    }

    if (body.action === "complete") {
      if (order.status !== "delivering" || !order.picked_up_at) {
        throw apiError(
          409,
          "Confirm food pickup before completing this delivery."
        );
      }
const [proofRows] = await connection.execute(
  `
    SELECT order_id
    FROM order_delivery_proofs
    WHERE order_id = ?
      AND driver_id = ?
  `,
  [order.id, driver.id]
);

if (!proofRows.length) {
  throw apiError(
    409,
    "Upload a delivery photo before completing this order."
  );
}
      const deliveryNote = requiredText(
        body.delivery_note,
        "Delivery confirmation"
      );

      if (
        !["number", "string"].includes(typeof body.cod_collected) ||
        String(body.cod_collected).trim() === ""
      ) {
        throw apiError(400, "Collected COD amount is required.");
      }

      const collected = Number(body.cod_collected);
      const expected = Number(order.cod_amount);

      if (
        !Number.isSafeInteger(collected) ||
        collected < 0 ||
        collected !== expected
      ) {
        throw apiError(
          400,
          `Collected COD must be exactly ${expected.toLocaleString(
            "en-US"
          )} VND.`
        );
      }

      await connection.execute(
        `
          UPDATE orders
          SET status = 'completed',
              delivered_at = UTC_TIMESTAMP(),
              delivery_note = ?,
              cod_collected = ?
          WHERE id = ?
        `,
        [deliveryNote, collected, order.id]
      );

      // Credit earnings and rewards inside the completion transaction.
      const {
        creditCompletion,
      } = require("./driver-wallet-store");

      await creditCompletion(
        connection,
        driver.id,
        order
      );

      eventType = "delivery_completed";
      note = deliveryNote;
    }

    if (body.action === "fail") {
      if (order.status !== "delivering") {
        throw apiError(
          409,
          "Only a delivery in progress can be reported as failed."
        );
      }

      const failureReason = requiredText(
        body.failure_reason,
        "Failure reason"
      );

      await connection.execute(
        `
          UPDATE orders
          SET status = 'failed',
              failure_reason = ?
          WHERE id = ?
        `,
        [failureReason, order.id]
      );

      eventType = "delivery_failed";
      note = failureReason;
    }

    await connection.execute(
      `
        INSERT INTO order_events (
          order_id,
          actor_user_id,
          event_type,
          note
        )
        VALUES (?, ?, ?, ?)
      `,
      [order.id, req.user.id, eventType, note]
    );

    await connection.commit();

    res.json({
      message: "Delivery progress updated successfully.",
      data: {
        order_id: order.id,
        action: body.action,
      },
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("Delivery rollback failed:", rollbackError.code);
      }
    }

    if (error.status) {
      return res.status(error.status).json({
        message: error.message,
      });
    }

    console.error("Delivery progress update failed:", error.code);

    res.status(500).json({
      message: "Unable to update delivery progress.",
    });
  } finally {
    if (connection) connection.release();
  }
});
// Driver wallet, distance preferences and order messages.
// The existing middleware has already verified the linked driver.
router.use(
  require("./driver-workspace").createWorkspaceRouter(pool)
);

router.use(require("./delivery-proof"));
router.get("/route-plan", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  try {
    const { planDriverRoute } = require("./route-planner");

    const [orders] = await pool.execute(
      `SELECT
         o.id,
         o.order_code,
         o.delivery_address,
         o.latitude,
         o.longitude,
         o.picked_up_at,
         r.address AS pickup_address,
         r.latitude AS pickup_latitude,
         r.longitude AS pickup_longitude
       FROM orders o
       LEFT JOIN restaurants r ON r.id = o.restaurant_id
       WHERE o.driver_id = ?
         AND o.status IN ('assigned', 'delivering')
       ORDER BY o.id`,
      [req.driver.id]
    );

    let plan;

    if (!orders.length) {
      plan = {
        stops: [],
        estimated_total_km: 0,
        estimated_travel_minutes: 0,
        method: "No active deliveries."
      };
    } else {
      try {
        plan = planDriverRoute(req.driver, orders);
      } catch (error) {
        return res.status(422).json({
          message: error.message
        });
      }
    }

    return res.json({
      data: {
        ...plan,
        generated_at: new Date().toISOString(),
        position_note:
          "Starts from stored driver coordinates; GPS freshness is not assessed.",
        estimate_note:
          "Modeled distance and travel time. Excludes service time and live traffic. Not road navigation."
      }
    });
  } catch (error) {
    console.error(
      "Driver route planning failed:",
      error.code || error.name
    );

    return res.status(500).json({
      message: "Unable to generate the suggested stop order."
    });
  }
});
module.exports = router;

