"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const {
  normalizeExternalId,
  isExternalDuplicate,
  integrationAuth,
} = require("./order-import-policy");

const {
  operationState,
} = require("./manager-operations");

const {
  deviceLabel,
} = require("./mail");

test("source IDs normalize and reject invalid inputs", () => {
  assert.equal(
    normalizeExternalId("  partner_Ab-01  "),
    "PARTNER_AB-01"
  );

  const invalid = [
    null,
    123,
    "",
    "../x",
    "A\nB",
    "đơn-1",
    "A".repeat(129),
  ];

  for (const value of invalid) {
    assert.throws(() => normalizeExternalId(value));
  }
});

test("only the external ID constraint counts as a duplicate import", () => {
  assert.equal(
    isExternalDuplicate({
      code: "ER_DUP_ENTRY",
      sqlMessage:
        "Duplicate entry 'X' for key " +
        "'orders.uq_orders_external_order_id'",
    }),
    true
  );

  assert.equal(
    isExternalDuplicate({
      code: "ER_DUP_ENTRY",
      sqlMessage:
        "Duplicate entry 'X' for key 'orders.order_code'",
    }),
    false
  );

  assert.equal(
    isExternalDuplicate({
      code: "ER_NO_REFERENCED_ROW_2",
      message: "uq_orders_external_order_id",
    }),
    false
  );
});

test("operational status is independent of GPS", () => {
  assert.equal(
    operationState({
      status: "offline",
      delivering_orders: 1,
    }),
    "Delivering"
  );

  assert.equal(
    operationState({
      status: "available",
      active_orders: 0,
    }),
    "Idle"
  );

  assert.equal(
    operationState({
      status: "available",
      active_orders: 1,
      delivering_orders: 0,
    }),
    "Online"
  );

  assert.equal(
    operationState({
      status: "offline",
      active_orders: 0,
    }),
    "Offline"
  );
});

test("device labels handle known and missing information", () => {
  assert.equal(
    deviceLabel(null),
    "Không xác định"
  );

  assert.equal(
    deviceLabel(
      "Mozilla Windows Chrome/130 Safari/537 Edg/130"
    ),
    "Edge / Windows"
  );

  assert.equal(
    deviceLabel("Mozilla Android Chrome/130"),
    "Chrome / Android"
  );
});

test("integration authentication requires dedicated credentials", () => {
  const original = process.env.ORDER_IMPORT_TOKEN;

  const response = {
    status(code) {
      this.code = code;
      return this;
    },

    json() {
      return this;
    },
  };

  try {
    delete process.env.ORDER_IMPORT_TOKEN;

    integrationAuth(
      { headers: {} },
      response,
      () => assert.fail("Authentication must fail.")
    );

    assert.equal(response.code, 503);

    // Synthetic credential used only by this test.
    process.env.ORDER_IMPORT_TOKEN = "A".repeat(40);

    integrationAuth(
      {
        headers: {
          authorization: "Bearer wrong",
        },
      },
      response,
      () => assert.fail("Authentication must fail.")
    );

    assert.equal(response.code, 401);

    let passed = false;

    integrationAuth(
      {
        headers: {
          authorization:
            `Bearer ${"A".repeat(40)}`,
        },
      },
      response,
      () => {
        passed = true;
      }
    );

    assert.equal(passed, true);
  } finally {
    if (original == null) {
      delete process.env.ORDER_IMPORT_TOKEN;
    } else {
      process.env.ORDER_IMPORT_TOKEN = original;
    }
  }
});

test("tracking avoids overlap, reuses markers and expires stale data", async () => {
  const intervals = new Map();
  const activeMarkers = new Set();

  let serial = 0;
  let clock = 0;
  let calls = 0;
  let resolveRequest;
  let fail = false;

  function element() {
    return {
      textContent: "",
      append() {},
    };
  }

  const context = {
    window: {},

    document: {
      readyState: "loading",
      addEventListener() {},
      createElement: element,
    },

    Date,
    Map,
    Set,
    Number,
    String,
    AbortController,
    setTimeout,
    clearTimeout,

    performance: {
      now: () => clock,
    },

    setInterval(fn, milliseconds) {
      const id = ++serial;

      intervals.set(id, {
        fn,
        milliseconds,
      });

      return id;
    },

    clearInterval(id) {
      intervals.delete(id);
    },

    fetch() {},

    L: {
      circleMarker() {
        const marker = {
          popup: {
            setContent() {},
          },

          addTo() {
            activeMarkers.add(marker);
            return marker;
          },

          bindPopup() {
            return marker;
          },

          getPopup() {
            return marker.popup;
          },

          setLatLng() {
            return marker;
          },

          setStyle() {
            return marker;
          },
        };

        return marker;
      },
    },
  };

  const script = fs.readFileSync(
    path.join(
      __dirname,
      "../public/manager-tracking.js"
    ),
    "utf8"
  );

  vm.runInNewContext(script, context);

  const response = {
    ok: true,

    json: async () => ({
      server_time: new Date(0).toISOString(),
      freshness_seconds: 15,

      data: [
        {
          id: 1,
          latitude: 21,
          longitude: 105,
          location_updated_at:
            new Date(0).toISOString(),
          operational_state: "Idle",
          on_duty: true,
        },
      ],

      definition: "Synthetic test data.",
    }),
  };

  function fetcher() {
    calls++;

    if (fail) {
      return Promise.reject(
        new Error("Synthetic connection failure")
      );
    }

    return new Promise(resolve => {
      resolveRequest = resolve;
    });
  }

  const status = element();

  const map = {
    removeLayer(marker) {
      activeMarkers.delete(marker);
    },

    fitBounds() {
      assert.fail(
        "Live polling must preserve the viewport."
      );
    },
  };

  const tracker = context.window.createManagerTracker(
    map,
    status,
    fetcher
  );

  try {
    tracker.start();

    const poll = [...intervals.values()].find(
      timer => timer.milliseconds === 4000
    ).fn;

    // A second tick must not overlap the first request.
    poll();

    assert.equal(calls, 1);

    resolveRequest(response);
    await new Promise(setImmediate);

    assert.equal(tracker.size, 1);

    const originalMarker = [...activeMarkers][0];

    // Another response must update the same marker.
    poll();
    resolveRequest(response);

    await new Promise(setImmediate);

    assert.equal(
      [...activeMarkers][0],
      originalMarker
    );

    // Connection failures must be visible.
    fail = true;
    poll();

    await new Promise(setImmediate);

    assert.match(
      status.textContent,
      /Disconnected/
    );

    // Old markers must expire even without a response.
    clock = 16000;

    const expire = [...intervals.values()].find(
      timer => timer.milliseconds === 1000
    ).fn;

    expire();

    assert.equal(tracker.size, 0);
  } finally {
    tracker.stop();
  }

  assert.equal(intervals.size, 0);
  assert.equal(activeMarkers.size, 0);
});
