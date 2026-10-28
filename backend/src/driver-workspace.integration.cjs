"use strict";

// Destructive setup is permitted only in a disposable *_driver_test database.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

if (
  !process.env.DRIVER_TEST_DB ||
  !/^[a-z0-9_]+_driver_test$/.test(process.env.DRIVER_TEST_DB)
) {
  test(
    "Driver MySQL integration requires a disposable *_driver_test database",
    { skip: true },
    () => {}
  );
} else {
  Object.assign(process.env, {
    DATABASE_TARGET: "local",
    DB_HOST: process.env.DRIVER_TEST_HOST || "127.0.0.1",
    DB_PORT: process.env.DRIVER_TEST_PORT || "33316",
    DB_USER: process.env.DRIVER_TEST_USER || "root",
    DB_PASSWORD: process.env.DRIVER_TEST_PASSWORD || "",
    DB_NAME: process.env.DRIVER_TEST_DB,
  });

  const mysql = require("mysql2/promise");

  const {
    createToken,
    hashToken,
  } = require("../src/security");

  const {
    creditCompletion,
  } = require("../src/driver-wallet-store");

  let pool;
  let server;
  let base;

  const sessions = {};

  async function call(
    who,
    route,
    body,
    method = "POST",
    noCsrf = false
  ) {
    const session = sessions[who];

    const response = await fetch(`${base}${route}`, {
      method: body === undefined ? "GET" : method,
      headers: {
        ...(session
          ? {
              cookie: `fleet_session=${session.token}`,
            }
          : {}),
        ...(!noCsrf && session
          ? {
              "X-CSRF-Token": session.csrf,
            }
          : {}),
        "Content-Type": "application/json",
      },
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
          }),
    });

    const data = await response.json();

    return {
      status: response.status,
      ...data,
    };
  }

  const orderPath = (id) => `/api/driver/orders/${id}`;

  before(async () => {
    const admin = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });

    await admin.query(
      `DROP DATABASE IF EXISTS \`${process.env.DB_NAME}\``
    );

    await admin.query(
      `CREATE DATABASE \`${process.env.DB_NAME}\`
       CHARACTER SET utf8mb4`
    );

    await admin.query(
      `USE \`${process.env.DB_NAME}\``
    );

    const migrations = [
      "006-tidb-schema.sql",
      "007-delivery-operations.sql",
      "013-driver-workspace.sql",
      "013-driver-workspace.sql",
      "015-manager-notifications.sql",
      "016-order-message-reads.sql",
      "016-order-message-reads.sql",
    ];

    for (const filename of migrations) {
      const sql = fs.readFileSync(
        path.join(__dirname, "../sql", filename),
        "utf8"
      )
        .replace(/^--.*$/gm, "")
        .replaceAll(
          "shopeefood_db",
          process.env.DB_NAME
        );

      const statements = sql
        .split(";")
        .map((statement) => statement.trim())
        .filter(Boolean);

      for (const statement of statements) {
        await admin.query(statement);
      }
    }

    await admin.end();

    ({ pool } = require("../src/db"));

    await pool.query(
      `INSERT INTO zones (
         id, name, latitude, longitude
       ) VALUES (
         1, 'Test Hanoi', 21.02, 105.82
       )`
    );

    await pool.query(
      `INSERT INTO vehicles (
         id, plate_number, capacity_kg, maintenance_due
       ) VALUES
         (1, 'TEST-1', 20, '2099-01-01'),
         (2, 'TEST-2', 20, '2099-01-01')`
    );

    await pool.query(
      `INSERT INTO users (
         id, email, full_name, password_hash, role
       ) VALUES
         (
           1, 'manager@example.test', 'Test Manager',
           'not-a-login-hash', 'manager'
         ),
         (
           2, 'driver1@example.test', 'Test Driver One',
           'not-a-login-hash', 'driver'
         ),
         (
           3, 'driver2@example.test', 'Test Driver Two',
           'not-a-login-hash', 'driver'
         )`
    );

    await pool.query(
      `INSERT INTO drivers (
         id, driver_code, full_name, phone,
         zone_id, vehicle_id, latitude, longitude, user_id
       ) VALUES
         (
           1, 'TEST-D1', 'Test Driver One', '000',
           1, 1, 21.02, 105.82, 2
         ),
         (
           2, 'TEST-D2', 'Test Driver Two', '000',
           1, 2, 21.02, 105.82, 3
         )`
    );

    await pool.query(
      `INSERT INTO restaurants (
         id, name, address, phone,
         zone_id, latitude, longitude
       ) VALUES (
         1, 'Test Restaurant', 'Test Pickup', '000',
         1, 21.02, 105.82
       )`
    );

    const fixtures = [
      [1, 1, "assigned"],
      [2, 2, "assigned"],
      [3, 1, "assigned"],
      [4, null, "pending"],
      [5, 1, "assigned"],
    ];

    for (const [id, driver, status] of fixtures) {
      await pool.execute(
        `INSERT INTO orders (
           id, order_code, customer_name, customer_phone,
           delivery_address, total_amount, status, zone_id,
           driver_id, weight_kg, latitude, longitude,
           due_at, restaurant_id, delivery_fee,
           payment_method, cod_amount, assigned_at
         ) VALUES (
           ?, ?, 'Test Customer', '000',
           'Test Dropoff', 130000, ?, 1,
           ?, 1, 21.025, 105.825,
           DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR),
           1, 30000, 'cash', 130000, UTC_TIMESTAMP()
         )`,
        [id, `TEST-O${id}`, status, driver]
      );

      await pool.execute(
        `INSERT INTO order_items (
           order_id, item_name, quantity, unit_price
         ) VALUES (?, 'Test Food', 1, 100000)`,
        [id]
      );
    }

    await pool.query(
      "UPDATE orders SET latitude = 22 WHERE id = 5"
    );

    for (const [name, user] of [
      ["manager", 1],
      ["one", 2],
      ["two", 3],
    ]) {
      const token = createToken();
      const csrf = createToken();

      sessions[name] = { token, csrf };

      await pool.execute(
        `INSERT INTO sessions (
           token_hash, user_id, csrf_token, expires_at
         ) VALUES (
           ?, ?, ?,
           DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 HOUR)
         )`,
        [hashToken(token), user, csrf]
      );
    }

    const { app } = require("../server");

    server = await new Promise((resolve) => {
      const running = app.listen(
        0,
        "127.0.0.1",
        () => resolve(running)
      );
    });

    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }

    if (pool) {
      await pool.end();
    }
  });

  test("session, role and CSRF authorization protects wallet and progress", async () => {
    assert.equal(
      (await call(null, "/api/driver/wallet")).status,
      401
    );

    assert.equal(
      (await call("manager", "/api/driver/wallet")).status,
      403
    );

    assert.equal(
      (
        await call(
          "one",
          "/api/driver-support/wallet/requests"
        )
      ).status,
      403
    );

    assert.equal(
      (
        await call(
          "one",
          `${orderPath(1)}/accept`,
          {},
          "POST",
          true
        )
      ).status,
      403
    );
  });

  test("drivers see only their assigned deliveries and cannot self-assign open orders", async () => {
    const result = await call("one", "/api/driver/orders");

    assert.equal(result.status, 200);

    assert.ok(
      result.data.every(
        (order) =>
          Number(order.id) !== 2 &&
          Number(order.id) !== 4
      )
    );

    assert.equal(
      (await call("one", orderPath(2))).status,
      404
    );

    assert.equal(
      (
        await call(
          "one",
          `${orderPath(4)}/accept`,
          {}
        )
      ).status,
      404
    );

    assert.equal(
      (
        await call(
          "two",
          `${orderPath(1)}/accept`,
          {}
        )
      ).status,
      404
    );
  });

  test("only one concurrent acceptance succeeds; acceptance does not complete or reward", async () => {
    const results = await Promise.all([
      call("one", `${orderPath(1)}/accept`, {}),
      call("one", `${orderPath(1)}/accept`, {}),
    ]);

    assert.deepEqual(
      results.map((result) => result.status).sort(),
      [200, 409]
    );

    const [[order]] = await pool.query(
      "SELECT status, picked_up_at FROM orders WHERE id = 1"
    );

    assert.equal(order.status, "delivering");
    assert.equal(order.picked_up_at, null);

    const wallet = await call("one", "/api/driver/wallet");

    assert.equal(Number(wallet.data.points), 0);
  });

  test("server enforces distance preference on acceptance", async () => {
    assert.equal(
      (
        await call(
          "one",
          "/api/driver/preferences",
          { max_delivery_km: 11 },
          "PUT"
        )
      ).status,
      400
    );

    assert.equal(
      (
        await call(
          "one",
          "/api/driver/preferences",
          { max_delivery_km: 5 },
          "PUT"
        )
      ).status,
      200
    );

    assert.equal(
      (
        await call(
          "one",
          `${orderPath(5)}/accept`,
          {}
        )
      ).status,
      409
    );
  });

  test("progress rejects invalid sequence, missing proof and incorrect COD; completion credits once", async () => {
    const progress = (body) =>
      call(
        "one",
        `${orderPath(1)}/progress`,
        body
      );

    assert.equal(
      (
        await progress({
          action: "complete",
          cod_collected: 130000,
          delivery_note: "Received",
        })
      ).status,
      409
    );

    assert.equal(
      (
        await progress({
          action: "pickup",
          order_code: "TEST-O1",
        })
      ).status,
      409
    );

    assert.equal(
      (await progress({ action: "arrive" })).status,
      200
    );

    assert.equal(
      (
        await progress({
          action: "pickup",
          order_code: "WRONG",
        })
      ).status,
      400
    );

    assert.equal(
      (
        await progress({
          action: "pickup",
          order_code: "TEST-O1",
        })
      ).status,
      200
    );

    assert.equal(
      (
        await progress({
          action: "complete",
          cod_collected: 130000,
          delivery_note: "Received",
        })
      ).status,
      409
    );

    await pool.execute(
      `INSERT INTO order_delivery_proofs (
         order_id, driver_id, content_type,
         image_data, byte_size
       ) VALUES (1, 1, 'image/jpeg', ?, 4)`,
      [Buffer.from([255, 216, 255, 217])]
    );

    await pool.query(
      "UPDATE driver_wallets SET points = 80 WHERE driver_id = 1"
    );

    assert.equal(
      (
        await progress({
          action: "complete",
          cod_collected: 1,
          delivery_note: "Received",
        })
      ).status,
      400
    );

    const body = {
      action: "complete",
      cod_collected: 130000,
      delivery_note: "Received by test customer",
    };

    const results = await Promise.all([
      progress(body),
      progress(body),
    ]);

    assert.deepEqual(
      results.map((result) => result.status).sort(),
      [200, 409]
    );

    const wallet = await call("one", "/api/driver/wallet");

    assert.equal(Number(wallet.data.points), 100);
    assert.equal(Number(wallet.data.cash_balance), 80000);

    assert.equal(
      wallet.entries.filter(
        (entry) => entry.entry_type === "delivery_fee"
      ).length,
      1
    );

    assert.equal(
      wallet.entries.filter(
        (entry) => entry.entry_type === "reward_bonus"
      ).length,
      1
    );
  });

  test("completion store guards duplicate event credit even if called again", async () => {
    const db = await pool.getConnection();

    try {
      await db.beginTransaction();

      await creditCompletion(db, 1, {
        id: 1,
        order_code: "TEST-O1",
        delivery_fee: 30000,
      });

      await db.commit();
    } finally {
      db.release();
    }

    const [[wallet]] = await pool.query(
      `SELECT cash_balance, points
       FROM driver_wallets
       WHERE driver_id = 1`
    );

    assert.equal(Number(wallet.cash_balance), 80000);
    assert.equal(Number(wallet.points), 100);
  });

  test("wallet request retries are idempotent and reservations prevent overspending", async () => {
    const body = {
      request_type: "withdrawal",
      amount: 60000,
      request_key: randomUUID(),
      status: "approved",
      id: 999999,
      driver_id: 2,
    };

    const results = await Promise.all([
      call("one", "/api/driver/wallet/requests", body),
      call("one", "/api/driver/wallet/requests", body),
    ]);

    assert.ok(
      results.every((result) => result.status === 201)
    );

    assert.equal(
      results[0].data.id,
      results[1].data.id
    );

    assert.equal(results[0].data.status, "pending");
    assert.notEqual(Number(results[0].data.id), 999999);

    assert.equal(
      (
        await call(
          "one",
          "/api/driver/wallet/requests",
          { ...body, amount: 10000 }
        )
      ).status,
      409
    );

    assert.equal(
      (
        await call(
          "one",
          "/api/driver/wallet/requests",
          {
            ...body,
            request_key: randomUUID(),
            amount: 30000,
          }
        )
      ).status,
      409
    );

    assert.equal(
      (
        await call(
          "one",
          "/api/driver/wallet/requests",
          {
            ...body,
            request_key: randomUUID(),
            amount: -10000,
          }
        )
      ).status,
      400
    );

    const wallet = await call("one", "/api/driver/wallet");

    assert.equal(wallet.data.available_cash, 20000);

    const other = await call("two", "/api/driver/wallet");

    assert.equal(other.requests.length, 0);
  });

  test("Manager rejection releases reservation; top-up stays pending until verified review", async () => {
    const listing = await call(
      "manager",
      "/api/driver-support/wallet/requests"
    );

    const withdrawal = listing.data.find(
      (request) => request.request_type === "withdrawal"
    );

    const review = (requestId, body) =>
      call(
        "manager",
        `/api/driver-support/wallet/requests/${requestId}/review`,
        body
      );

    assert.equal(
      (
        await review(withdrawal.id, {
          status: "rejected",
          reference: "No payout made",
        })
      ).status,
      200
    );

    assert.equal(
      (await call("one", "/api/driver/wallet")).data.available_cash,
      80000
    );

    const topup = await call(
      "one",
      "/api/driver/wallet/requests",
      {
        request_type: "topup",
        amount: 100000,
        request_key: randomUUID(),
      }
    );

    assert.equal(
      Number(
        (await call("one", "/api/driver/wallet")).data.deposit_balance
      ),
      0
    );

    assert.equal(
      (
        await review(topup.data.id, {
          status: "approved",
          reference: "",
        })
      ).status,
      400
    );

    const decision = {
      status: "approved",
      reference: "TEST-RECEIPT-ONLY",
    };

    const results = await Promise.all([
      review(topup.data.id, decision),
      review(topup.data.id, decision),
    ]);

    assert.ok(
      results.every((result) => result.status === 200)
    );

    const wallet = await call("one", "/api/driver/wallet");

    assert.equal(Number(wallet.data.deposit_balance), 100000);

    assert.equal(
      wallet.entries.filter(
        (entry) => entry.entry_type === "topup"
      ).length,
      1
    );
  });

  test("GPS validates types, timestamps and own driver scope", async () => {
    assert.equal(
      (
        await call("one", "/api/driver/location", {
          latitude: "21",
          longitude: 105,
          accuracy_m: 10,
        })
      ).status,
      400
    );

    assert.equal(
      (
        await call("one", "/api/driver/location", {
          latitude: 21,
          longitude: 105,
          accuracy_m: 10,
          captured_at: Date.now() - 120000,
        })
      ).status,
      400
    );

    const result = await call(
      "one",
      "/api/driver/location",
      {
        latitude: 21.03,
        longitude: 105.83,
        accuracy_m: 10,
        captured_at: Date.now(),
        driver_id: 2,
      }
    );

    assert.equal(result.status, 200);

    const [[other]] = await pool.query(
      "SELECT latitude FROM drivers WHERE id = 2"
    );

    assert.equal(Number(other.latitude), 21.02);

    assert.equal(
      (
        await call("one", "/api/driver/location", {
          latitude: 21.03,
          longitude: 105.83,
          accuracy_m: 10,
        })
      ).status,
      429
    );
  });

  test("messages persist, retries deduplicate, cross-driver reads and writes are denied", async () => {
    const body = {
      message_text:
        "<img src=x onerror=alert(1)> Arrived at pickup.",
      message_key: randomUUID(),
    };

    const route = `${orderPath(3)}/messages`;

    const sent = await call("one", route, body);

    assert.equal(sent.status, 201);

    assert.equal(
      (await call("one", route, body)).data.id,
      sent.data.id
    );

    assert.equal(
      (await call("two", route)).status,
      404
    );

    assert.equal(
      (
        await call("two", route, {
          ...body,
          message_key: randomUUID(),
        })
      ).status,
      404
    );

    const saved = await call("one", route);

    assert.equal(
      saved.data[0].message_text,
      body.message_text
    );

    assert.equal(
      (
        await call(
          "manager",
          "/api/driver-support/orders/3/messages",
          {
            message_text: "Support acknowledged.",
            message_key: randomUUID(),
          }
        )
      ).status,
      201
    );

    assert.equal(
      (await call("one", route)).data.length,
      2
    );

    assert.equal(
      (
        await call(
          "one",
          `${orderPath(1)}/messages`,
          {
            message_text: "Closed",
            message_key: randomUUID(),
          }
        )
      ).status,
      409
    );
  });

  test("route recommendation uses actual assigned orders and pickup precedence", async () => {
    const result = await call(
      "one",
      "/api/driver/route-plan"
    );

    assert.equal(result.status, 200);

    assert.ok(
      result.data.stops.every(
        (stop) =>
          Number(stop.order_id) !== 2 &&
          Number(stop.order_id) !== 1
      )
    );

    for (const orderId of [3, 5]) {
      const pickupIndex = result.data.stops.findIndex(
        (stop) =>
          stop.order_id === orderId &&
          stop.type === "pickup"
      );

      const deliveryIndex = result.data.stops.findIndex(
        (stop) =>
          stop.order_id === orderId &&
          stop.type === "delivery"
      );

      assert.ok(pickupIndex >= 0);
      assert.ok(deliveryIndex > pickupIndex);
    }
  });
}
