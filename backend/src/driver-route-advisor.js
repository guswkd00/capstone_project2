"use strict";

const { MODEL, haversineKm } = require("./dss");
const { planDriverRoute } = require("./route-planner");

const SERVICE_MINUTES = {
  pickup: 2,
  delivery: 1,
};

const round = value => Number(value.toFixed(2));

function time(value) {
  if (!value) return NaN;

  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
  ) {
    return Date.parse(value.replace(" ", "T") + "Z");
  }

  return new Date(value).getTime();
}

function validPoint(point) {
  return (
    point &&
    [point.latitude, point.longitude].every(
      value =>
        value !== null &&
        value !== undefined &&
        value !== "" &&
        Number.isFinite(Number(value))
    ) &&
    Math.abs(Number(point.latitude)) <= 90 &&
    Math.abs(Number(point.longitude)) <= 180
  );
}

function rank(a, b) {
  return (
    a.late_orders - b.late_orders ||
    a.late_minutes - b.late_minutes ||
    a.elapsed - b.elapsed ||
    a.km - b.km
  );
}

function buildAdvice(driver, orders, now = Date.now()) {
  if (
    !Array.isArray(orders) ||
    orders.length > MODEL.maxActiveOrders
  ) {
    throw new Error(
      "The advisor supports at most 3 active assigned orders."
    );
  }

  if (orders.length && !validPoint(driver)) {
    throw new Error(
      "Share GPS or save valid driver coordinates before planning."
    );
  }

  const warnings = [];

  const list = orders.map(order => {
    const pickup = {
      latitude: order.pickup_latitude,
      longitude: order.pickup_longitude,
      address: order.pickup_address,
    };

    const dropoff = {
      latitude: order.latitude,
      longitude: order.longitude,
      address: order.delivery_address,
    };

    if (
      !validPoint(dropoff) ||
      (!order.picked_up_at && !validPoint(pickup))
    ) {
      throw new Error(
        `Coordinates are missing for order ${order.order_code}.`
      );
    }

    const prep =
      order.estimated_prep_minutes == null ||
      order.estimated_prep_minutes === ""
        ? NaN
        : Number(order.estimated_prep_minutes);

    const created = time(order.created_at);
    const suppliedReady = time(order.ready_at);

    const ready = Number.isFinite(suppliedReady)
      ? suppliedReady
      : (
          Number.isFinite(created) &&
          Number.isFinite(prep) &&
          prep >= 0 &&
          prep <= 180
        )
        ? created + prep * 60000
        : NaN;

    const deadline = time(order.due_at);

    if (
      !order.picked_up_at &&
      !Number.isFinite(ready)
    ) {
      warnings.push(
        `${order.order_code}: prep time is unknown; ` +
        "readiness is assumed to be now."
      );
    }

    if (!Number.isFinite(deadline)) {
      warnings.push(
        `${order.order_code}: deadline is unknown; ` +
        "bundling cannot be recommended."
      );
    }

    return {
      o: order,
      pickup,
      dropoff,
      ready,
      deadline,
    };
  });

  function simulate(sequence) {
    let current = driver;
    let elapsed = 0;
    let km = 0;
    let travel = 0;
    let waiting = 0;

    let onboard = list.filter(
      item => item.o.picked_up_at
    ).length;

    let maxOnboard = onboard;

    const stops = [];
    const lateness = {};

    for (const step of sequence) {
      const item = list[step.index];
      const pickup = step.type === "pickup";
      const target = pickup ? item.pickup : item.dropoff;

      const leg =
        haversineKm(current, target) * MODEL.roadFactor;

      const minutes = leg / MODEL.speedKmh * 60;

      elapsed += minutes;
      travel += minutes;
      km += leg;

      const arrival = now + elapsed * 60000;

      const wait =
        pickup && Number.isFinite(item.ready)
          ? Math.max(0, (item.ready - arrival) / 60000)
          : 0;

      elapsed += wait + SERVICE_MINUTES[step.type];
      waiting += wait;

      onboard += pickup ? 1 : -1;
      maxOnboard = Math.max(maxOnboard, onboard);

      const late =
        !pickup && Number.isFinite(item.deadline)
          ? Math.max(
              0,
              (
                now +
                elapsed * 60000 -
                item.deadline
              ) / 60000
            )
          : 0;

      if (!pickup) {
        lateness[String(item.o.id)] = late;
      }

      stops.push({
        sequence: stops.length + 1,
        order_id: item.o.id,
        order_code: item.o.order_code,
        type: step.type,
        address: target.address,
        latitude: Number(target.latitude),
        longitude: Number(target.longitude),
        estimated_leg_km: round(leg),
        estimated_wait_minutes: round(wait),
        estimated_arrival_at:
          new Date(arrival).toISOString(),
        estimated_departure_at:
          new Date(now + elapsed * 60000).toISOString(),
        estimated_late_minutes: round(late),
        ready_at:
          pickup && Number.isFinite(item.ready)
            ? new Date(item.ready).toISOString()
            : null,
      });

      current = target;
    }

    return {
      stops,
      km,
      travel,
      elapsed,
      waiting,
      maxOnboard,
      lateness,
      late_orders: Object.values(lateness).filter(
        value => value > 0
      ).length,
      late_minutes: Object.values(lateness).reduce(
        (sum, value) => sum + value,
        0
      ),
    };
  }

  function search(sequential) {
    let best = null;

    const picked = list.map(
      item => Boolean(item.o.picked_up_at)
    );

    const delivered = list.map(() => false);

    function visit(sequence, locked = -1) {
      if (delivered.every(Boolean)) {
        const result = simulate(sequence);

        if (!best || rank(result, best) < 0) {
          best = result;
        }

        return;
      }

      for (let index = 0; index < list.length; index++) {
        if (
          delivered[index] ||
          (
            sequential &&
            locked !== -1 &&
            locked !== index
          )
        ) {
          continue;
        }

        const type = picked[index]
          ? "delivery"
          : "pickup";

        if (type === "pickup") {
          picked[index] = true;
        } else {
          delivered[index] = true;
        }

        visit(
          [...sequence, { index, type }],
          sequential && type === "pickup"
            ? index
            : -1
        );

        if (type === "pickup") {
          picked[index] = false;
        } else {
          delivered[index] = false;
        }
      }
    }

    visit([]);

    return best;
  }

  const optimized = search(false);
  const sequential = search(true);

  const nearestStops = list.length
    ? planDriverRoute(driver, orders).stops
    : [];

  const nearest = simulate(
    nearestStops.map(stop => ({
      index: list.findIndex(
        item =>
          String(item.o.id) === String(stop.order_id)
      ),
      type: stop.type,
    }))
  );

  const feesKnown = list.every(
    ({ o }) =>
      o.delivery_fee != null &&
      o.delivery_fee !== "" &&
      Number.isFinite(Number(o.delivery_fee)) &&
      Number(o.delivery_fee) >= 0
  );

  const rate =
    driver.cost_per_km == null ||
    driver.cost_per_km === ""
      ? NaN
      : Number(driver.cost_per_km);

  const costsKnown =
    Number.isFinite(rate) && rate >= 0;

  const revenue = feesKnown
    ? list.reduce(
        (sum, { o }) => sum + Number(o.delivery_fee),
        0
      )
    : null;

  const cost = costsKnown
    ? Math.round(optimized.km * rate)
    : null;

  const margin =
    revenue !== null && cost !== null
      ? revenue - cost
      : null;

  if (!feesKnown) {
    warnings.push(
      "Some delivery fees are missing; " +
      "earnings cannot be estimated."
    );
  }

  if (!costsKnown) {
    warnings.push(
      "Vehicle cost per km is missing; " +
      "operating cost and margin cannot be estimated."
    );
  }

  const readyKnown = list.every(
    item =>
      item.o.picked_up_at ||
      Number.isFinite(item.ready)
  );

  const deadlinesKnown = list.every(
    item => Number.isFinite(item.deadline)
  );

  const noWorseLateness = list.every(
    item =>
      (
        optimized.lateness[String(item.o.id)] || 0
      ) <= (
        sequential.lateness[String(item.o.id)] || 0
      ) + 0.001
  );

  const kmSaved = sequential.km - optimized.km;
  const minutesSaved =
    sequential.elapsed - optimized.elapsed;

  const capacity = Number(driver.capacity_kg);

  const workloadKnown = list.every(
    ({ o }) =>
      o.weight_kg != null &&
      Number.isFinite(Number(o.weight_kg)) &&
      Number(o.weight_kg) > 0
  );

  const totalWeight = list.reduce(
    (sum, { o }) => sum + Number(o.weight_kg || 0),
    0
  );

  const maintenance = time(driver.maintenance_due);

  const maintained =
    Number.isFinite(maintenance) &&
    new Date(maintenance).toISOString().slice(0, 10) >=
      new Date(now).toISOString().slice(0, 10);

  const safe =
    maintained &&
    Number(driver.zone_active) === 1 &&
    driver.status === "available" &&
    driver.vehicle_status === "available" &&
    workloadKnown &&
    Number.isFinite(capacity) &&
    capacity > 0 &&
    totalWeight <= capacity &&
    list.every(
      ({ o }) =>
        Number(o.zone_id) === Number(driver.zone_id)
    );

  if (list.length > 1 && !safe) {
    warnings.push(
      "Vehicle, payload, zone or availability checks " +
      "did not pass; bundling is not recommended."
    );
  }

  const recommended =
    safe &&
    list.length > 1 &&
    optimized.maxOnboard > 1 &&
    readyKnown &&
    deadlinesKnown &&
    noWorseLateness &&
    (
      kmSaved > 0.01 ||
      minutesSaved > 0.5
    ) &&
    margin !== null &&
    margin > 0;

  const key = result =>
    result.stops
      .map(stop => `${stop.order_id}:${stop.type}`)
      .join("|");

  return {
    stops: optimized.stops,
    estimated_total_km: round(optimized.km),
    estimated_travel_minutes:
      Math.ceil(optimized.travel),
    estimated_wait_minutes:
      round(optimized.waiting),
    estimated_total_minutes:
      round(optimized.elapsed),
    predicted_late_orders:
      optimized.late_orders,

    method:
      "Prep-time-aware search; pickup before delivery; " +
      "lateness before duration and distance.",

    prep_time: {
      resequenced:
        key(optimized) !== key(nearest),
      nearest_wait_minutes:
        round(nearest.waiting),
      optimized_wait_minutes:
        round(optimized.waiting),
      minutes_saved_vs_nearest:
        round(nearest.elapsed - optimized.elapsed),
      readiness_source:
        "Estimated order creation time plus restaurant " +
        "prep minutes; not a live kitchen feed.",
    },

    bundling: {
      recommended,

      status:
        list.length < 2
          ? "More assigned orders needed"
          : recommended
            ? "Bundle suggested"
            : "No beneficial bundle confirmed",

      order_codes:
        list.map(item => item.o.order_code),

      max_orders_onboard:
        optimized.maxOnboard,

      distance_saved_km:
        round(kmSaved),

      minutes_saved:
        round(minutesSaved),

      cost_saved:
        costsKnown
          ? Math.round(kmSaved * rate)
          : null,

      comparison:
        "Best sequential service of the same assigned " +
        "orders from the same starting position.",
    },

    profitability: {
      delivery_fees: revenue,
      cost_per_km: costsKnown ? rate : null,
      estimated_operating_cost: cost,
      estimated_margin: margin,

      note:
        "Estimated delivery fees minus modeled vehicle cost. " +
        "Excludes COD, rewards, waiting-time cost and other " +
        "overhead; not net profit.",
    },

    assumptions: {
      speed_kmh: MODEL.speedKmh,
      road_factor: MODEL.roadFactor,
      pickup_service_minutes:
        SERVICE_MINUTES.pickup,
      delivery_service_minutes:
        SERVICE_MINUTES.delivery,
    },

    warnings,
  };
}

module.exports = { buildAdvice };
