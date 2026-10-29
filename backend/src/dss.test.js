const { test } = require("node:test");
const assert = require("node:assert/strict");
const { haversineKm, recommendDrivers } = require("./dss");

const now = Date.parse("2026-10-13T10:00:00Z");

const order = {
  zone_id: 1,
  weight_kg: 2,
  latitude: 10.782,
  longitude: 106.708,
  pickup_latitude: 10.7769,
  pickup_longitude: 106.7009,
  due_at: "2026-10-13T11:00:00Z",
};

const driver = {
  id: 1,
  full_name: "Demo Driver",
  status: "available",
  vehicle_status: "available",
  zone_id: 1,
  zone_active: 1,
  capacity_kg: 20,
  active_orders: 0,
  active_weight_kg: 0,
  maintenance_due: "2026-12-12",
  latitude: 10.778,
  longitude: 106.702,
};

test("Distance calculation matches a known example", () => {
  const km = haversineKm(
    { latitude: 0, longitude: 0 },
    { latitude: 0, longitude: 1 }
  );

  assert.ok(Math.abs(km - 111.195) < 0.01);
});

test("Eligible drivers are ranked by workload and distance", () => {
  const candidates = recommendDrivers(order, [
    { ...driver, id: 1, active_orders: 2 },
    { ...driver, id: 2, active_orders: 0 },
  ], now);

  assert.equal(candidates[0].id, 2);
  assert.equal(candidates[0].eligible, true);
  assert.ok(candidates[0].eta_minutes > 0);
  assert.equal(candidates[1].score - candidates[0].score, 8);
});

test("Safety rules reject unsuitable candidates", () => {
  const cases = [
    { status: "offline" },
    { vehicle_status: "maintenance" },
    { zone_id: 2 },
    { zone_active: 0 },
    { active_orders: 3 },
    { active_weight_kg: 19 },
    { maintenance_due: "2026-01-01" },
  ];

  for (const changes of cases) {
    const [candidate] = recommendDrivers(
      order,
      [{ ...driver, ...changes }],
      now
    );

    assert.equal(candidate.eligible, false);
    assert.ok(candidate.reasons.length > 0);
  }
});

test("An expired deadline produces a lateness penalty", () => {
  const [candidate] = recommendDrivers(
    { ...order, due_at: "2026-10-13T10:00:00Z" },
    [driver],
    now
  );

  assert.ok(candidate.late_minutes > 0);
  assert.ok(candidate.score >= candidate.late_minutes * 2);
});

test("An order with missing routing data is rejected", () => {
  assert.throws(
    () => recommendDrivers(
      { ...order, latitude: null },
      [driver],
      now
    ),
    /missing valid dispatch information/
  );
});