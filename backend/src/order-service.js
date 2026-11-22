"use strict";

const {
  normalizeExternalId,
} = require("./order-import-policy");

function inputError(message) {
  return Object.assign(
    new Error(message),
    { status: 400 }
  );
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
  const number = requiredNumber(
    value,
    label,
    minimum,
    maximum
  );

  if (!Number.isSafeInteger(number)) {
    throw inputError(
      `${label} must be a whole number.`
    );
  }

  return number;
}

async function createFoodOrder(body, db, identity = {}) {
  let connection;

  try {
    if (identity.externalId != null) {
      identity = {
        ...identity,
        externalId: normalizeExternalId(
          identity.externalId
        ),
      };
    }

    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body)
    ) {
      throw inputError(
        "A valid food order is required."
      );
    }

    const orderCode = requiredText(
      body.order_code,
      "Order code",
      30
    );

    if (!/^[A-Za-z0-9_-]+$/.test(orderCode)) {
      throw inputError(
        "Order code can contain only letters, " +
        "numbers, - and _."
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
        "Phone must contain 8–15 digits, " +
        "optionally starting with +."
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

    if (
      Math.abs(
        weight * 100 - Math.round(weight * 100)
      ) > 0.000001
    ) {
      throw inputError(
        "Weight supports up to 2 decimal places."
      );
    }

    const deliveryFee = wholeNumber(
      body.delivery_fee,
      "Delivery fee",
      0,
      1000000
    );

    if (
      !["prepaid", "cash"].includes(
        body.payment_method
      )
    ) {
      throw inputError(
        "Select prepaid or cash payment."
      );
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
      throw inputError(
        "Delivery deadline must be in the future."
      );
    }

    if (
      !Array.isArray(body.items) ||
      body.items.length < 1 ||
      body.items.length > 50
    ) {
      throw inputError(
        "An order requires 1–50 food items."
      );
    }

    const items = body.items.map(item => {
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item)
      ) {
        throw inputError("Invalid food item.");
      }

      return {
        item_name: requiredText(
          item.item_name,
          "Item name",
          150
        ),

        quantity: wholeNumber(
          item.quantity,
          "Quantity",
          1,
          100
        ),

        unit_price: wholeNumber(
          item.unit_price,
          "Unit price",
          0,
          1000000000
        ),
      };
    });

    const foodSubtotal = items.reduce(
      (sum, item) =>
        sum + item.quantity * item.unit_price,
      0
    );

    const totalAmount = foodSubtotal + deliveryFee;

    if (
      !Number.isSafeInteger(totalAmount) ||
      totalAmount > 1000000000
    ) {
      throw inputError(
        "Order total cannot exceed 1,000,000,000 VND."
      );
    }

    const codAmount =
      body.payment_method === "cash"
        ? totalAmount
        : 0;

    connection = await db.getConnection();

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
        "The restaurant is unavailable or " +
        "its service zone is inactive."
      );
    }

    const restaurant = restaurants[0];

    const [result] = await connection.execute(
      `
        INSERT INTO orders (
          order_code,
          external_order_id,
          import_source,
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
        VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, 'pending'
        )
      `,
      [
        orderCode,
        identity.externalId || null,
        identity.source || "manual",
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

    return {
      id: result.insertId,
      order_code: orderCode,
      food_subtotal: foodSubtotal,
      delivery_fee: deliveryFee,
      total_amount: totalAmount,
      payment_method: body.payment_method,
      cod_amount: codAmount,
      status: "pending",
    };
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch {
        // Preserve the original failure.
      }
    }

    throw error;
  } finally {
    connection?.release();
  }
}

module.exports = {
  createFoodOrder,
};
