"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const {
  policy,
  rewardFor,
  deliveryDistance,
  validateRequest,
} = require("./driver-workspace-policy");

const {
  planDriverRoute,
} = require("./route-planner");

test("rewards credit configured thresholds only when crossing a tier", () => {
  const config = {
    points_per_delivery: 20,
    tiers: [
      {
        points: 100,
        bonus: 50000,
      },
    ],
  };

  assert.deepEqual(
    rewardFor(80, config),
    {
      points: 20,
      bonus: 50000,
    }
  );

  assert.deepEqual(
    rewardFor(100, config),
    {
      points: 20,
      bonus: 0,
    }
  );

  assert.deepEqual(
    rewardFor(0, config),
    {
      points: 20,
      bonus: 0,
    }
  );
});

test("financial requests require whole VND, bounded amounts and idempotency keys", () => {
  const base = {
    amount: 10000,
    request_type: "withdrawal",
    request_key: randomUUID(),
  };

  assert.doesNotThrow(() => validateRequest(base));

  const invalidChanges = [
    { amount: -1 },
    { amount: 9999 },
    { amount: "10000" },
    { amount: 10000.5 },
    { amount: 10000001 },
    { request_key: "retry" },
    { request_type: "transfer" },
  ];

  for (const patch of invalidChanges) {
    assert.throws(
      () => validateRequest({
        ...base,
        ...patch,
      }),
      (error) => error.status === 400
    );
  }
});

test("server distance uses validated coordinates and existing road factor", () => {
  assert.equal(
    deliveryDistance({
      latitude: 21,
      longitude: 105,
      pickup_latitude: 21,
      pickup_longitude: 105,
    }),
    0
  );

  assert.throws(
    () => deliveryDistance({
      latitude: null,
    }),
    (error) => error.status === 409
  );

  assert.ok(
    deliveryDistance({
      latitude: 21.1,
      longitude: 105,
      pickup_latitude: 21,
      pickup_longitude: 105,
    }) > 10
  );
});

test("configured distance limits reject invalid environment values", () => {
  const saved = process.env.DRIVER_MAX_DELIVERY_KM;

  try {
    process.env.DRIVER_MAX_DELIVERY_KM = "invalid";

    assert.throws(policy);
  } finally {
    if (saved === undefined) {
      delete process.env.DRIVER_MAX_DELIVERY_KM;
    } else {
      process.env.DRIVER_MAX_DELIVERY_KM = saved;
    }
  }
});

test("existing route planner preserves pickup precedence and handles already collected food", () => {
  const driver = {
    latitude: 21,
    longitude: 105.8,
  };

  const orders = [1, 2].map((id) => ({
    id,
    order_code: `O${id}`,
    latitude: 21.01,
    longitude: 105.8,
    pickup_latitude: 21.02,
    pickup_longitude: 105.8,
    picked_up_at:
      id === 2 ? "2026-01-01" : null,
  }));

  const plan = planDriverRoute(driver, orders);

  assert.equal(plan.stops.length, 3);

  const pickupIndex = plan.stops.findIndex(
    (stop) =>
      stop.order_id === 1 &&
      stop.type === "pickup"
  );

  const deliveryIndex = plan.stops.findIndex(
    (stop) =>
      stop.order_id === 1 &&
      stop.type === "delivery"
  );

  assert.ok(pickupIndex >= 0);
  assert.ok(deliveryIndex > pickupIndex);

  assert.equal(
    plan.stops.filter(
      (stop) =>
        stop.order_id === 2 &&
        stop.type === "pickup"
    ).length,
    0
  );
});
