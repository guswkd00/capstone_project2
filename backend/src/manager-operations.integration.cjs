"use strict";

const {
  test,
  before,
  after,
} = require("node:test");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const target = process.env.MANAGER_TEST_DB;

if (
  !target ||
  !/^[a-z0-9_]+_manager_test$/.test(target)
) {
  test(
    "Requires an explicitly disposable *_manager_test database",
    { skip: true },
    () => {}
  );
} else {
  Object.assign(process.env, {
    DATABASE_TARGET: "local",
    DB_NAME: target,

    DB_HOST:
      process.env.MANAGER_TEST_HOST || "127.0.0.1",

    DB_PORT:
      process.env.MANAGER_TEST_PORT || "33316",

    DB_USER:
      process.env.MANAGER_TEST_USER || "root",

    DB_PASSWORD:
      process.env.MANAGER_TEST_PASSWORD ||
      "isolated-manager-test",

    ORDER_IMPORT_TOKEN:
      "integration-test-only-credential-32-characters",

    ORDER_IMPORT_SOURCE: "test_partner",
    MANAGER_LOGIN_EMAIL: "manager@tests.example",
    GPS_FRESHNESS_SECONDS: "60",
  });

  const mysql = require("mysql2/promise");

  const {
    migrate,
  } = require("../migrations/021-manager-operations");

  const {
    createToken,
    hashToken,
    hashPassword,
  } = require("./security");

  let db;
  let server;
  let base;

  const sessions = {};

  // Synthetic password for disposable test accounts only.
  const password = "Disposable-test-password-123";

  async function call(who, route, body, method) {
    const headers = {
      "Content-Type": "application/json",
    };

    if (who === "partner") {
      headers.Authorization =
        `Bearer ${process.env.ORDER_IMPORT_TOKEN}`;
    } else if (sessions[who]) {
      headers.cookie =
        `fleet_session=${sessions[who].token}`;

      headers["X-CSRF-Token"] =
        sessions[who].csrf;
    }

    const response = await fetch(
      `${base}${route}`,
      {
        method:
          method ||
          (body === undefined ? "GET" : "POST"),

        headers,

        ...(body === undefined
          ? {}
          : { body: JSON.stringify(body) }),
      }
    );

    return {
      status: response.status,
      ...(await response.json()),
    };
  }

  function payload(id) {
    return {
      order_id: id,
      order_code: `MANUAL-${id}`,
      customer_name: "Synthetic Customer",
      customer_phone: "0901234567",
      delivery_address: "Synthetic Hanoi address",
      restaurant_id: 1,
      latitude: 21.029,
      longitude: 105.855,
      weight_kg: 1,
      delivery_fee: 5000,
      payment_method: "cash",

      due_at: new Date(
        Date.now() + 7200000
      ).toISOString(),

      items: [
        {
          item_name: "Synthetic meal",
          quantity: 1,
          unit_price: 10000,
        },
      ],
    };
  }

  before(async () => {
    const admin = await mysql.createConnection({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });

    // The database name has passed the disposable-name guard.
    await admin.query(
      `DROP DATABASE IF EXISTS \`${target}\``
    );

    await admin.query(
      `CREATE DATABASE \`${target}\` CHARACTER SET utf8mb4`
    );

    await admin.query(
      `USE \`${target}\``
    );

    const schemas = [
      "006-tidb-schema.sql",
      "007-delivery-operations.sql",
      "013-driver-workspace.sql",
      "015-manager-notifications.sql",
      "016-order-message-reads.sql",
    ];

    for (const name of schemas) {
      const sql = fs.readFileSync(
        path.join(__dirname, "../sql", name),
        "utf8"
      )
        .replace(/^--.*$/gm, "")
        .replaceAll("shopeefood_db", target);

      const statements = sql
        .split(";")
        .map(statement => statement.trim())
        .filter(Boolean);

      for (const statement of statements) {
        await admin.query(statement);
      }
    }

    await admin.query(`
      INSERT INTO zones (
        id, name, latitude, longitude
      )
      VALUES
        (1, 'Hoàn Kiếm', 21.0285, 105.8542),
        (2, 'Existing Central Hub', 10.77, 106.7)
    `);

    await migrate(admin);
    await migrate(admin);

    await admin.end();

    ({ pool: db } = require("./db"));

    const passwordHash = await hashPassword(password);

    await db.execute(
      `
        INSERT INTO users (
          id, email, full_name, password_hash, role
        )
        VALUES
          (
            1,
            'manager@tests.example',
            'Test Manager',
            ?,
            'manager'
          ),
          (
            2,
            'driver@tests.example',
            'Test Driver',
            ?,
            'driver'
          )
      `,
      [passwordHash, passwordHash]
    );

    await db.query(`
      INSERT INTO vehicles (
        id, plate_number, capacity_kg, maintenance_due
      )
      VALUES (
        1, 'TEST-ONE', 20, '2099-01-01'
      )
    `);

    await db.query(`
      INSERT INTO drivers (
        id,
        driver_code,
        full_name,
        phone,
        zone_id,
        vehicle_id,
        latitude,
        longitude,
        user_id
      )
      VALUES (
        1,
        'TEST-D1',
        'Test Driver',
        '0901234567',
        1,
        1,
        21.0285,
        105.8542,
        2
      )
    `);

    await db.query(`
      INSERT INTO restaurants (
        id,
        name,
        address,
        phone,
        zone_id,
        latitude,
        longitude
      )
      VALUES (
        1,
        'Test restaurant',
        'Test pickup',
        '0901234567',
        1,
        21.0285,
        105.8542
      )
    `);

    for (const [name, userId] of [
      ["manager", 1],
      ["driver", 2],
    ]) {
      const token = createToken();
      const csrf = createToken();

      sessions[name] = {
        token,
        csrf,
      };

      await db.execute(
        `
          INSERT INTO sessions (
            token_hash,
            user_id,
            csrf_token,
            expires_at
          )
          VALUES (
            ?, ?, ?,
            DATE_ADD(
              UTC_TIMESTAMP(),
              INTERVAL 1 HOUR
            )
          )
        `,
        [
          hashToken(token),
          userId,
          csrf,
        ]
      );
    }

    const app = require("../server").app;

    server = app.listen(0, "127.0.0.1");

    await new Promise(resolve => {
      server.once("listening", resolve);
    });

    base =
      `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    if (server) {
      await new Promise(resolve => {
        server.close(resolve);
      });
    }

    await db?.end();
  });

  test("migration preserves IDs and seeds 12 Hanoi zones", async () => {
    const [[count]] = await db.query(`
      SELECT COUNT(*) AS count
      FROM zones
      WHERE code LIKE 'HN-%'
    `);

    assert.equal(count.count, 12);

    const [[zone]] = await db.query(`
      SELECT id
      FROM zones
      WHERE code = 'HN-HOAN-KIEM'
    `);

    assert.equal(zone.id, 1);

    const [[central]] = await db.query(`
      SELECT name
      FROM zones
      WHERE id = 2
    `);

    assert.equal(
      central.name,
      "Existing Central Hub"
    );
  });

  test("Manager APIs enforce authentication, role and CSRF", async () => {
    for (const endpoint of [
      "zone-summary",
      "tracking",
    ]) {
      assert.equal(
        (
          await call(
            "driver",
            `/api/fleet/${endpoint}`
          )
        ).status,
        403
      );

      assert.equal(
        (
          await call(
            null,
            `/api/fleet/${endpoint}`
          )
        ).status,
        401
      );
    }

    assert.equal(
      (
        await call(
          "driver",
          "/api/fleet/drivers/1/zone",
          { zone_id: 2 },
          "PUT"
        )
      ).status,
      403
    );

    const noCsrf = await fetch(
      `${base}/api/fleet/drivers/1/zone`,
      {
        method: "PUT",
        headers: {
          cookie:
            `fleet_session=${sessions.manager.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ zone_id: 2 }),
      }
    );

    assert.equal(noCsrf.status, 403);

    assert.equal(
      (
        await call(
          "manager",
          "/api/fleet/drivers/1/zone",
          { zone_id: 99999 },
          "PUT"
        )
      ).status,
      400
    );
  });

  test("unassigned drivers remain visible and can receive a zone", async () => {
    await db.query(`
      ALTER TABLE drivers
      MODIFY zone_id INT UNSIGNED NULL
    `);

    await db.query(`
      UPDATE drivers
      SET zone_id = NULL
      WHERE id = 1
    `);

    const fleet = await call(
      "manager",
      "/api/fleet/drivers"
    );

    assert.equal(fleet.data.length, 1);
    assert.equal(fleet.data[0].zone_id, null);

    const summary = await call(
      "manager",
      "/api/fleet/zone-summary"
    );

    assert.equal(summary.unassigned_drivers, 1);

    assert.equal(
      (
        await call(
          "manager",
          "/api/fleet/drivers/1/zone",
          { zone_id: 1 },
          "PUT"
        )
      ).status,
      200
    );
  });

  test("zone transfers preserve existing deliveries", async () => {
    const first = await call(
      "manager",
      "/api/orders",
      payload("ZONE-A")
    );

    const second = await call(
      "manager",
      "/api/orders",
      payload("ZONE-B")
    );

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);

    await db.execute(
      `
        UPDATE orders
        SET driver_id = 1, status = 'assigned'
        WHERE id IN (?, ?)
      `,
      [first.data.id, second.data.id]
    );

    assert.equal(
      (
        await call(
          "driver",
          `/api/driver/orders/${first.data.id}/accept`,
          {}
        )
      ).status,
      200
    );

    assert.equal(
      (
        await call(
          "manager",
          "/api/fleet/drivers/1/zone",
          { zone_id: 2 },
          "PUT"
        )
      ).status,
      200
    );

    const [orders] = await db.execute(
      `
        SELECT id, driver_id, zone_id, status
        FROM orders
        WHERE id IN (?, ?)
      `,
      [first.data.id, second.data.id]
    );

    assert.ok(
      orders.every(
        order =>
          order.driver_id === 1 &&
          order.zone_id === 1
      )
    );

    assert.equal(
      orders.find(
        order => order.id === first.data.id
      ).status,
      "delivering"
    );

    assert.equal(
      (
        await call(
          "driver",
          `/api/driver/orders/${second.data.id}/accept`,
          {}
        )
      ).status,
      200
    );

    assert.equal(
      (
        await call(
          "driver",
          `/api/driver/orders/${first.data.id}/progress`,
          { action: "arrive" }
        )
      ).status,
      200
    );

    const next = await call(
      "manager",
      "/api/orders",
      payload("ZONE-C")
    );

    const recommendations = await call(
      "manager",
      `/api/dispatch/${next.data.id}/recommendations`
    );

    const driver = recommendations.candidates.find(
      item => item.id === 1
    );

    assert.ok(
      driver.reasons.some(
        reason => /different zone/.test(reason)
      )
    );

    const summary = await call(
      "manager",
      "/api/fleet/zone-summary"
    );

    assert.equal(
      Number(
        summary.data.find(
          zone => zone.id === 2
        ).on_duty_drivers
      ),
      1
    );
  });

  test("GPS sharing, expiry and operational status are independent", async () => {
    const sharing = await call(
      "driver",
      "/api/driver/location/sharing",
      { enabled: true }
    );

    const location = await call(
      "driver",
      "/api/driver/location",
      {
        latitude: 21.03,
        longitude: 105.85,
        accuracy_m: 10,
        captured_at: Date.now(),
        sharing_token: sharing.sharing_token,
      }
    );

    assert.equal(location.status, 200);

    let live = await call(
      "manager",
      "/api/fleet/tracking"
    );

    assert.equal(live.data.length, 1);

    assert.equal(
      live.data[0].operational_state,
      "Delivering"
    );

    await db.query(`
      UPDATE drivers
      SET status = 'offline'
      WHERE id = 1
    `);

    live = await call(
      "manager",
      "/api/fleet/tracking"
    );

    assert.equal(live.data[0].on_duty, false);

    assert.equal(
      live.data[0].operational_state,
      "Delivering"
    );

    const summary = await call(
      "manager",
      "/api/fleet/zone-summary"
    );

    assert.equal(
      Number(
        summary.data.find(
          zone => zone.id === 2
        ).on_duty_drivers
      ),
      0
    );

    await db.query(`
      UPDATE drivers
      SET status = 'available'
      WHERE id = 1
    `);

    await call(
      "driver",
      "/api/driver/location/sharing",
      {
        enabled: false,
        sharing_token: sharing.sharing_token,
      }
    );

    assert.equal(
      (
        await call(
          "manager",
          "/api/fleet/tracking"
        )
      ).data.length,
      0
    );

    await call(
      "driver",
      "/api/driver/location",
      {
        latitude: 21.03,
        longitude: 105.85,
        accuracy_m: 10,
        sharing_token: sharing.sharing_token,
      }
    );

    assert.equal(
      (
        await call(
          "manager",
          "/api/fleet/tracking"
        )
      ).data.length,
      0
    );

    const replacement = await call(
      "driver",
      "/api/driver/location/sharing",
      { enabled: true }
    );

    await db.execute(
      `
        UPDATE drivers
        SET
          gps_location_token = ?,
          location_updated_at = DATE_SUB(
            UTC_TIMESTAMP(),
            INTERVAL 90 SECOND
          )
        WHERE id = 1
      `,
      [hashToken(replacement.sharing_token)]
    );

    assert.equal(
      (
        await call(
          "manager",
          "/api/fleet/tracking"
        )
      ).data.length,
      0
    );

    // An old tab cannot stop a newer sharing session.
    await call(
      "driver",
      "/api/driver/location/sharing",
      {
        enabled: false,
        sharing_token: sharing.sharing_token,
      }
    );

    const [[driver]] = await db.query(`
      SELECT gps_sharing_enabled
      FROM drivers
      WHERE id = 1
    `);

    assert.equal(driver.gps_sharing_enabled, 1);

    await db.query(`
      UPDATE drivers
      SET location_updated_at = UTC_TIMESTAMP()
      WHERE id = 1
    `);

    assert.equal(
      (
        await call(
          "manager",
          "/api/fleet/tracking"
        )
      ).data.length,
      1
    );

    const edited = await call(
      "manager",
      "/api/fleet/drivers/1",
      {
        driver_code: "TEST-D1",
        full_name: "Test Driver",
        phone: "0901234567",
        zone_id: 2,
        vehicle_id: 1,
        status: "available",
        latitude: 21.04,
        longitude: 105.86,
      },
      "PUT"
    );

    assert.equal(edited.status, 200);

    assert.equal(
      (
        await call(
          "manager",
          "/api/fleet/tracking"
        )
      ).data.length,
      0
    );
  });

  test("manual and imported orders share validation", async () => {
    assert.equal(
      (
        await call(
          null,
          "/api/integrations/orders",
          payload("AUTH")
        )
      ).status,
      401
    );

    assert.equal(
      (
        await call(
          "manager",
          "/api/integrations/orders",
          payload("AUTH")
        )
      ).status,
      401
    );

    const invalid = {
      ...payload("INVALID"),
      items: [],
    };

    assert.equal(
      (
        await call(
          "partner",
          "/api/integrations/orders",
          invalid
        )
      ).status,
      400
    );

    assert.equal(
      (
        await call(
          "manager",
          "/api/orders",
          invalid
        )
      ).status,
      400
    );

    assert.equal(
      (
        await call(
          "partner",
          "/api/integrations/orders",
          {
            ...payload("BAD-ID"),
            order_id: "../bad",
          }
        )
      ).status,
      400
    );
  });

  test("concurrent imports create exactly one immutable order", async () => {
    const results = await Promise.all(
      Array.from(
        { length: 8 },
        () =>
          call(
            "partner",
            "/api/integrations/orders",
            payload("  SOURCE-001  ")
          )
      )
    );

    assert.equal(
      results.filter(
        result => result.status === 201
      ).length,
      1
    );

    assert.equal(
      results.filter(
        result =>
          result.outcome === "duplicate_ignored"
      ).length,
      7
    );

    const repeated = await call(
      "partner",
      "/api/integrations/orders",
      {
        ...payload("source-001"),
        customer_name: "Changed",
        due_at: "2000-01-01T00:00:00Z",
      }
    );

    assert.equal(
      repeated.outcome,
      "duplicate_ignored"
    );

    const [orders] = await db.query(`
      SELECT *
      FROM orders
      WHERE external_order_id = 'SOURCE-001'
    `);

    assert.equal(orders.length, 1);

    assert.equal(
      orders[0].customer_name,
      "Synthetic Customer"
    );

    assert.equal(
      orders[0].import_source,
      "test_partner"
    );

    const [[items]] = await db.execute(
      `
        SELECT COUNT(*) AS count
        FROM order_items
        WHERE order_id = ?
      `,
      [orders[0].id]
    );

    assert.equal(items.count, 1);

    const list = await call(
      "manager",
      "/api/orders"
    );

    assert.ok(
      list.data.some(
        order =>
          order.external_order_id === "SOURCE-001" &&
          order.import_source === "test_partner"
      )
    );
  });

  test("email failures do not block login or duplicate recipients", async () => {
    Object.assign(process.env, {
      BREVO_API_KEY: "dummy-test-only",
      EMAIL_FROM: "sender@tests.example",
      APP_PUBLIC_URL: "http://127.0.0.1:3000",
    });

    const nativeFetch = global.fetch;
    const sent = [];

    global.fetch = async (url, options) => {
      if (
        String(url).startsWith(
          "https://api.brevo.com/"
        )
      ) {
        sent.push(JSON.parse(options.body));

        throw Object.assign(
          new Error("Synthetic mail outage"),
          { code: "TEST_MAIL_OUTAGE" }
        );
      }

      return nativeFetch(url, options);
    };

    try {
      assert.equal(
        (
          await call(
            null,
            "/api/auth/login",
            {
              email: "manager@tests.example",
              password,
            }
          )
        ).status,
        200
      );

      await new Promise(
        resolve => setTimeout(resolve, 20)
      );

      assert.equal(sent.length, 1);

      assert.equal(
        (
          await call(
            null,
            "/api/auth/login",
            {
              email: "driver@tests.example",
              password,
            }
          )
        ).status,
        200
      );

      await new Promise(
        resolve => setTimeout(resolve, 20)
      );

      assert.equal(sent.length, 3);

      const audit = sent.find(
        email =>
          email.to[0].email ===
            "manager@tests.example" &&
          email.textContent.includes("Role: driver")
      );

      assert.ok(audit);

      assert.ok(
        audit.textContent.includes(
          "Asia/Ho_Chi_Minh"
        )
      );

      assert.ok(
        audit.textContent.includes("Device:")
      );

      assert.ok(
        sent.every(
          email =>
            !email.textContent.includes(password) &&
            !email.textContent.includes(
              "dummy-test-only"
            )
        )
      );
    } finally {
      global.fetch = nativeFetch;
      delete process.env.BREVO_API_KEY;
    }
  });

  test("duplicate preflight stops without changing existing orders", async () => {
    const first = await call(
      "manager",
      "/api/orders",
      payload("DUP-A")
    );

    const second = await call(
      "manager",
      "/api/orders",
      payload("DUP-B")
    );

    await db.query(`
      ALTER TABLE orders
      DROP INDEX uq_orders_external_order_id
    `);

    await db.execute(
      `
        UPDATE orders
        SET external_order_id = ' dup '
        WHERE id = ?
      `,
      [first.data.id]
    );

    await db.execute(
      `
        UPDATE orders
        SET external_order_id = 'DUP'
        WHERE id = ?
      `,
      [second.data.id]
    );

    const [beforeRows] = await db.query(`
      SELECT id, external_order_id
      FROM orders
      ORDER BY id
    `);

    await assert.rejects(
      migrate(db),
      /Duplicate external order IDs.*DUP/
    );

    const [afterRows] = await db.query(`
      SELECT id, external_order_id
      FROM orders
      ORDER BY id
    `);

    assert.deepEqual(afterRows, beforeRows);

    await db.execute(
      `
        UPDATE orders
        SET external_order_id = NULL
        WHERE id IN (?, ?)
      `,
      [first.data.id, second.data.id]
    );

    await migrate(db);
  });
}
