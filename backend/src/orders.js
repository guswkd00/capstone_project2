const express = require("express");
const { pool } = require("./db");
const {
  createFoodOrder,
} = require("./order-service");

const router = express.Router();

// Get pending orders.
router.get("/pending", async (req, res) => {
  try {
    const [orders] = await pool.execute(`
      SELECT id, order_code, customer_name,
             total_amount, status, created_at
      FROM orders
      WHERE status = 'pending'
      ORDER BY created_at DESC, id DESC
    `);

    res.json({ data: orders });
  } catch (error) {
    console.error("Pending orders query failed:", error.code);

    res.status(500).json({
      message: "Unable to retrieve pending orders.",
    });
  }
});

// Get restaurants accepting new orders.
router.get("/restaurants", async (req, res) => {
  try {
    const [restaurants] = await pool.execute(`
      SELECT
        r.id,
        r.name,
        r.address,
        r.phone,
        r.latitude,
        r.longitude,
        r.zone_id,
        r.estimated_prep_minutes,
        z.name AS service_zone
      FROM restaurants r
      JOIN zones z ON z.id = r.zone_id
      WHERE r.accepting_orders = 1
        AND z.active = 1
      ORDER BY r.name
    `);

    res.json({ data: restaurants });
  } catch (error) {
    console.error("Restaurants query failed:", error.code);

    res.status(500).json({
      message: "Unable to retrieve restaurants.",
    });
  }
});

// Get all orders.
router.get("/", async (req, res) => {
  try {
    const [orders] = await pool.execute(`
      SELECT id, order_code, customer_name,
             total_amount, status, created_at
      FROM orders
      ORDER BY created_at DESC, id DESC
    `);

    res.json({ data: orders });
  } catch (error) {
    console.error("Orders query failed:", error.code);

    res.status(500).json({
      message: "Unable to retrieve orders.",
    });
  }
});

// Create a food order using the shared validation service.
router.post("/", async (req, res) => {
  try {
    const data = await createFoodOrder(
      req.body,
      pool
    );

    return res.status(201).json({
      message: "Food order created successfully.",
      data,
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "This order code already exists.",
      });
    }

    if (error.status === 400) {
      return res.status(400).json({
        message: error.message,
      });
    }

    console.error(
      "Food order creation failed:",
      error.code || error.name
    );

    return res.status(500).json({
      message: "Unable to create the food order.",
    });
  }
});

// Get food order details.
router.get("/:id", async (req, res) => {
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
          o.customer_phone,
          o.delivery_address,
          o.food_subtotal,
          o.delivery_fee,
          o.total_amount,
          o.payment_method,
          o.cod_amount,
          o.cod_collected,
          o.delivery_note,
          o.delivered_at,
          o.status,
          o.created_at,
          r.name AS restaurant_name,
          r.address AS pickup_address,
          r.phone AS restaurant_phone,
          d.full_name AS assigned_driver,
          s.received_amount AS cod_received_amount,
          s.confirmed_at AS cod_settled_at,
          manager.full_name AS cod_confirmed_by
        FROM orders o
        LEFT JOIN restaurants r ON r.id = o.restaurant_id
        LEFT JOIN drivers d ON d.id = o.driver_id
        LEFT JOIN order_cod_settlements s ON s.order_id = o.id
        LEFT JOIN users manager ON manager.id = s.confirmed_by
        WHERE o.id = ?
      `,
      [orderId]
    );

    if (!orders.length) {
      return res.status(404).json({
        message: "Order not found.",
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

    res.json({
      data: orders[0],
      items,
    });
  } catch (error) {
    console.error("Food order details query failed:", error.code);

    res.status(500).json({
      message: "Unable to retrieve order details.",
    });
  }
});
// Manager-only access is enforced in server.js.
router.get("/:id/proof", async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  const orderId = Number(req.params.id);

  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    return res.status(400).json({
      message: "Invalid order ID.",
    });
  }

  try {
    const [rows] = await pool.execute(
      `SELECT content_type, image_data
       FROM order_delivery_proofs
       WHERE order_id = ?`,
      [orderId]
    );

    if (!rows.length) {
      return res.status(404).json({
        message: "No delivery photo is available.",
      });
    }

    const proof = rows[0];

    if (
      !["image/jpeg", "image/png", "image/webp"].includes(
        proof.content_type
      ) ||
      !Buffer.isBuffer(proof.image_data)
    ) {
      return res.status(500).json({
        message: "Unable to display the delivery photo.",
      });
    }

    res.setHeader("Content-Type", proof.content_type);
    return res.send(proof.image_data);
  } catch (error) {
    console.error("Delivery photo query failed:", error.code);

    return res.status(500).json({
      message: "Unable to retrieve the delivery photo.",
    });
  }
});
router.post("/:id/cod-settlement", async (req, res) => {
  if (req.user?.role !== "manager") {
    return res.status(403).json({
      message: "Manager access required."
    });
  }

  const orderId = Number(req.params.id);
  const amount = req.body?.received_amount;

  if (
    !Number.isSafeInteger(orderId) ||
    orderId <= 0 ||
    !Number.isSafeInteger(amount) ||
    amount <= 0
  ) {
    return res.status(400).json({
      message: "Provide a valid order ID and received amount in VND."
    });
  }

  let connection;

  const reject = (status, message) => {
    throw Object.assign(new Error(message), { status });
  };

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [orders] = await connection.execute(
      `SELECT id, driver_id, status, payment_method,
              cod_amount, cod_collected
       FROM orders
       WHERE id = ?
       FOR UPDATE`,
      [orderId]
    );

    const order = orders[0];

    if (!order) {
      reject(404, "Order not found.");
    }

    if (
      order.status !== "completed" ||
      order.payment_method !== "cash" ||
      !order.driver_id
    ) {
      reject(409, "Only completed cash orders can be settled.");
    }

    if (
      amount !== Number(order.cod_amount) ||
      amount !== Number(order.cod_collected)
    ) {
      reject(
        409,
        "Received amount must match the required and collected COD."
      );
    }

    const [existing] = await connection.execute(
      `SELECT order_id
       FROM order_cod_settlements
       WHERE order_id = ?`,
      [orderId]
    );

    if (existing.length) {
      reject(409, "COD has already been settled for this order.");
    }

    await connection.execute(
      `INSERT INTO order_cod_settlements
         (order_id, driver_id, received_amount, confirmed_by)
       VALUES (?, ?, ?, ?)`,
      [orderId, order.driver_id, amount, req.user.id]
    );

    await connection.commit();

    res.setHeader("Cache-Control", "no-store");
    return res.status(201).json({
      message: "COD handover confirmed successfully."
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch {}
    }

    const status = [400, 404, 409].includes(error.status)
      ? error.status
      : 500;

    if (status === 500) {
      console.error("COD settlement failed:", error.code || error.name);
    }

    return res.status(status).json({
      message: status === 500
        ? "Unable to confirm COD handover."
        : error.message
    });
  } finally {
    connection?.release();
  }
});
module.exports = router;
