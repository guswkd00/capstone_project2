const express = require("express");
const { pool } = require("./db");

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

function inputError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function requiredText(value, label, maxLength) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > maxLength
  ) {
    throw inputError(
      `${label} must contain 1–${maxLength} characters.`
    );
  }

  return value.trim();
}

function requiredNumber(value, label, minimum, maximum) {
  if (
    !["number", "string"].includes(typeof value) ||
    String(value).trim() === ""
  ) {
    throw inputError(`${label} is required.`);
  }

  const number = Number(value);

  if (
    !Number.isFinite(number) ||
    number < minimum ||
    number > maximum
  ) {
    throw inputError(
      `${label} must be between ${minimum} and ${maximum}.`
    );
  }

  return number;
}

function wholeNumber(value, label, minimum, maximum) {
  const number = requiredNumber(value, label, minimum, maximum);

  if (!Number.isSafeInteger(number)) {
    throw inputError(`${label} must be a whole number.`);
  }

  return number;
}

// Create a food order and its items together.
router.post("/", async (req, res) => {
  let connection;

  try {
    const body = req.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw inputError("A valid food order is required.");
    }

    const orderCode = requiredText(body.order_code, "Order code", 30);

    if (!/^[A-Za-z0-9_-]+$/.test(orderCode)) {
      throw inputError(
        "Order code can contain only letters, numbers, - and _."
      );
    }

    const customerName = requiredText(
      body.customer_name,
      "Customer name",
      100
    );

    const customerPhone = requiredText(
      body.customer_phone,
      "Customer phone",
      20
    );

    if (!/^\+?[0-9]{8,15}$/.test(customerPhone)) {
      throw inputError(
        "Phone must contain 8–15 digits, optionally starting with +."
      );
    }

    const deliveryAddress = requiredText(
      body.delivery_address,
      "Delivery address",
      255
    );

    const restaurantId = wholeNumber(
      body.restaurant_id,
      "Restaurant ID",
      1,
      4294967295
    );

    const latitude = requiredNumber(
      body.latitude,
      "Delivery latitude",
      -90,
      90
    );

    const longitude = requiredNumber(
      body.longitude,
      "Delivery longitude",
      -180,
      180
    );

    const weight = requiredNumber(
      body.weight_kg,
      "Package weight",
      0.01,
      100000
    );

    if (Math.abs(weight * 100 - Math.round(weight * 100)) > 0.000001) {
      throw inputError("Weight supports up to 2 decimal places.");
    }

    const deliveryFee = wholeNumber(
      body.delivery_fee,
      "Delivery fee",
      0,
      1000000
    );

    if (!["prepaid", "cash"].includes(body.payment_method)) {
      throw inputError("Select prepaid or cash payment.");
    }

    if (
      typeof body.due_at !== "string" ||
      !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(body.due_at)
    ) {
      throw inputError(
        "Delivery deadline must include its timezone."
      );
    }

    const deadline = new Date(body.due_at);

    if (
      !Number.isFinite(deadline.getTime()) ||
      deadline.getTime() <= Date.now()
    ) {
      throw inputError("Delivery deadline must be in the future.");
    }

    if (
      !Array.isArray(body.items) ||
      body.items.length < 1 ||
      body.items.length > 50
    ) {
      throw inputError("An order requires 1–50 food items.");
    }

    const items = body.items.map(item => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw inputError("Invalid food item.");
      }

      return {
        item_name: requiredText(item.item_name, "Item name", 150),
        quantity: wholeNumber(item.quantity, "Quantity", 1, 100),
        unit_price: wholeNumber(
          item.unit_price,
          "Unit price",
          0,
          1000000000
        ),
      };
    });

    const foodSubtotal = items.reduce(
      (sum, item) => sum + item.quantity * item.unit_price,
      0
    );

    const totalAmount = foodSubtotal + deliveryFee;

    if (
      !Number.isSafeInteger(totalAmount) ||
      totalAmount > 1000000000
    ) {
      throw inputError("Order total cannot exceed 1,000,000,000 VND.");
    }

    const codAmount = body.payment_method === "cash"
      ? totalAmount
      : 0;

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [restaurants] = await connection.execute(
      `
        SELECT r.id, r.zone_id
        FROM restaurants r
        JOIN zones z ON z.id = r.zone_id
        WHERE r.id = ?
          AND r.accepting_orders = 1
          AND z.active = 1
        FOR UPDATE
      `,
      [restaurantId]
    );

    if (!restaurants.length) {
      throw inputError(
        "The restaurant is unavailable or its service zone is inactive."
      );
    }

    const restaurant = restaurants[0];

    const [result] = await connection.execute(
      `
        INSERT INTO orders (
          order_code,
          customer_name,
          customer_phone,
          delivery_address,
          restaurant_id,
          zone_id,
          latitude,
          longitude,
          weight_kg,
          due_at,
          food_subtotal,
          delivery_fee,
          total_amount,
          payment_method,
          cod_amount,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
      `,
      [
        orderCode,
        customerName,
        customerPhone,
        deliveryAddress,
        restaurantId,
        restaurant.zone_id,
        latitude,
        longitude,
        weight,
        deadline,
        foodSubtotal,
        deliveryFee,
        totalAmount,
        body.payment_method,
        codAmount,
      ]
    );

    for (const item of items) {
      await connection.execute(
        `
          INSERT INTO order_items (
            order_id,
            item_name,
            quantity,
            unit_price
          )
          VALUES (?, ?, ?, ?)
        `,
        [
          result.insertId,
          item.item_name,
          item.quantity,
          item.unit_price,
        ]
      );
    }

    await connection.commit();

    res.status(201).json({
      message: "Food order created successfully.",
      data: {
        id: result.insertId,
        order_code: orderCode,
        food_subtotal: foodSubtotal,
        delivery_fee: deliveryFee,
        total_amount: totalAmount,
        payment_method: body.payment_method,
        cod_amount: codAmount,
        status: "pending",
      },
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }

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

    console.error("Food order creation failed:", error.code);

    res.status(500).json({
      message: "Unable to create the food order.",
    });
  } finally {
    if (connection) connection.release();
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
          o.status,
          o.created_at,
          r.name AS restaurant_name,
          r.address AS pickup_address,
          r.phone AS restaurant_phone,
          d.full_name AS assigned_driver
        FROM orders o
        LEFT JOIN restaurants r ON r.id = o.restaurant_id
        LEFT JOIN drivers d ON d.id = o.driver_id
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
