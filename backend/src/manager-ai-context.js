"use strict";

const { MODEL, recommendDrivers } = require("./dss");
const { LIMITS } = require("./manager-ai-policy");

function contextError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function loadManagerAIContext(orderId, db, now = Date.now()) {
  const context = {
    generated_at: new Date(now).toISOString(),
    model: { ...MODEL },
    order: null,
    assignment_allowed: false,
    recommended_driver_id: null,
    candidates: [],
    total_candidates: 0,
    candidate_list_limited: false,
    warnings: [
      "Distance, ETA and cost are estimates, not live traffic."
    ]
  };

  if (orderId == null) {
    context.warnings.push(
      "No order selected. Give general workflow guidance only."
    );
    return context;
  }

  if (!Number.isSafeInteger(orderId) || orderId <= 0) {
    throw contextError(400, "Invalid order ID.");
  }

  const [rows] = await db.execute(
    `SELECT o.id, o.order_code, o.status, o.zone_id, o.driver_id,
       o.weight_kg, o.latitude, o.longitude,
       DATE_FORMAT(o.due_at, '%Y-%m-%dT%H:%i:%sZ') AS due_at,
       z.active AS zone_active,
       r.latitude AS pickup_latitude,
       r.longitude AS pickup_longitude
     FROM orders o
     LEFT JOIN zones z ON z.id = o.zone_id
     LEFT JOIN restaurants r
       ON r.id = o.restaurant_id AND r.zone_id = o.zone_id
     WHERE o.id = ?`,
    [orderId]
  );

  const order = rows[0];

  if (!order) {
    throw contextError(404, "Order not found.");
  }

  context.order = {
    id: Number(order.id),
    order_code: order.order_code,
    status: order.status,
    zone_id: Number(order.zone_id),
    weight_kg: Number(order.weight_kg),
    due_at: order.due_at,
    assigned_driver_id: order.driver_id == null
      ? null
      : Number(order.driver_id)
  };

  if (!["pending", "confirmed", "assigned"].includes(order.status)) {
    context.warnings.push(
      "This order is not open for assignment. Review only."
    );
    return context;
  }

  if (Number(order.zone_active) !== 1) {
    context.warnings.push(
      "The service zone is inactive or missing."
    );
    return context;
  }

  const [drivers] = await db.execute(
    `SELECT d.id, d.driver_code, d.zone_id, d.status,
       d.latitude, d.longitude, z.active AS zone_active,
       v.capacity_kg, v.cost_per_km,
       v.status AS vehicle_status,
       DATE_FORMAT(v.maintenance_due, '%Y-%m-%d') AS maintenance_due,
       COALESCE(w.active_orders, 0) AS active_orders,
       COALESCE(w.active_weight_kg, 0) AS active_weight_kg
     FROM drivers d
     JOIN zones z ON z.id = d.zone_id
     JOIN vehicles v ON v.id = d.vehicle_id
     LEFT JOIN (
       SELECT driver_id, COUNT(*) AS active_orders,
         SUM(weight_kg) AS active_weight_kg
       FROM orders
       WHERE status IN ('assigned', 'delivering') AND id <> ?
       GROUP BY driver_id
     ) w ON w.driver_id = d.id
     ORDER BY d.id`,
    [orderId]
  );

  let candidates;

  try {
    candidates = recommendDrivers(order, drivers, now);
  } catch (error) {
    if (
      error.message !==
      "The order is missing valid dispatch information."
    ) {
      throw error;
    }

    context.warnings.push(
      "The order is missing valid coordinates, weight or deadline."
    );
    return context;
  }

  context.total_candidates = candidates.length;
  context.candidate_list_limited =
    candidates.length > LIMITS.candidates;

  context.recommended_driver_id =
    candidates.find(item => item.eligible)?.id ?? null;

  context.assignment_allowed =
    context.recommended_driver_id != null;

  context.candidates = candidates
    .slice(0, LIMITS.candidates)
    .map(driver => ({
      driver_id: Number(driver.id),
      driver_code: driver.driver_code,
      eligible: driver.eligible,
      reasons: driver.reasons,
      active_orders: Number(driver.active_orders),
      active_weight_kg: Number(driver.active_weight_kg),
      capacity_kg: Number(driver.capacity_kg),
      pickup_km: driver.pickup_km,
      delivery_km: driver.delivery_km,
      eta_minutes: driver.eta_minutes,
      late_minutes: driver.late_minutes,
      score: driver.score,
      estimated_cost_vnd:
        driver.pickup_km != null &&
        driver.delivery_km != null &&
        driver.cost_per_km != null &&
        Number.isFinite(Number(driver.cost_per_km))
          ? Math.round(
              Number(
                (driver.pickup_km + driver.delivery_km).toFixed(2)
              ) * Number(driver.cost_per_km)
            )
          : null
    }));

  return context;
}

module.exports = { loadManagerAIContext };
