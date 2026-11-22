const MODEL = {
  roadFactor: 1.3,
  speedKmh: 25,
  pickupMinutes: 5,
  minutesPerActiveOrder: 5,
  maxActiveOrders: 3,
  workloadPenalty: 4,
  lateMinutePenalty: 2,
};

// Straight-line distance between two coordinates.
function haversineKm(a, b) {
  const radians = value => Number(value) * Math.PI / 180;

  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLng = radians(b.longitude) - radians(a.longitude);

  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(deltaLng / 2) ** 2;

  const bounded = Math.min(1, Math.max(0, value));

  return 6371 * 2 * Math.atan2(
    Math.sqrt(bounded),
    Math.sqrt(1 - bounded)
  );
}

function validCoordinates(latitude, longitude) {
  if (
    latitude === null ||
    longitude === null ||
    latitude === undefined ||
    longitude === undefined ||
    latitude === "" ||
    longitude === ""
  ) {
    return false;
  }

  const lat = Number(latitude);
  const lng = Number(longitude);

  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function utcTime(value) {
  if (!value) return NaN;

  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
  ) {
    return Date.parse(value.replace(" ", "T") + "Z");
  }

  return new Date(value).getTime();
}

function recommendDrivers(order, drivers, now = Date.now()) {
  const deadline = utcTime(order.due_at);
  const weight = Number(order.weight_kg);

  if (
    !order.zone_id ||
    !Number.isFinite(weight) ||
    weight <= 0 ||
    !Number.isFinite(deadline) ||
    !validCoordinates(order.latitude, order.longitude) ||
    !validCoordinates(order.pickup_latitude, order.pickup_longitude)
  ) {
    throw new Error("The order is missing valid dispatch information.");
  }

  const todayUtc = new Date(now).toISOString().slice(0, 10);

  const candidates = drivers.map(driver => {
    const reasons = [];

    const activeOrders = Number(driver.active_orders);
    const activeWeight = Number(driver.active_weight_kg);
    const capacity = Number(driver.capacity_kg);

    if (driver.status !== "available") {
      reasons.push("Driver is offline.");
    }

    if (driver.vehicle_status !== "available") {
      reasons.push("Vehicle is unavailable or under maintenance.");
    }

    if (Number(driver.zone_id) !== Number(order.zone_id)) {
      reasons.push("Driver serves a different zone.");
    }

    if (Number(driver.zone_active) !== 1) {
      reasons.push("Service zone is inactive.");
    }

    if (
      !Number.isInteger(activeOrders) ||
      activeOrders < 0 ||
      !Number.isFinite(activeWeight) ||
      activeWeight < 0
    ) {
      reasons.push("Current workload information is unavailable.");
    } else {
      if (activeOrders >= MODEL.maxActiveOrders) {
        reasons.push("Maximum 3 active orders reached.");
      }

      if (
        !Number.isFinite(capacity) ||
        capacity <= 0 ||
        activeWeight + weight > capacity
      ) {
        reasons.push("Vehicle payload capacity exceeded.");
      }
    }

    const maintenanceTime = utcTime(driver.maintenance_due);

    if (!Number.isFinite(maintenanceTime)) {
      reasons.push("Vehicle maintenance date is missing.");
    } else {
      const maintenanceDate =
        new Date(maintenanceTime).toISOString().slice(0, 10);

      if (maintenanceDate < todayUtc) {
        reasons.push("Vehicle maintenance is overdue.");
      }
    }

    const coordinatesValid = validCoordinates(
      driver.latitude,
      driver.longitude
    );

    if (!coordinatesValid) {
      reasons.push("Driver position is unavailable.");
    }

    let pickupKm = null;
    let deliveryKm = null;
    let etaMinutes = null;
    let lateMinutes = null;
    let score = null;

    if (
      coordinatesValid &&
      Number.isInteger(activeOrders) &&
      activeOrders >= 0
    ) {
      const pickup = {
        latitude: order.pickup_latitude,
        longitude: order.pickup_longitude,
      };

      pickupKm = haversineKm(driver, pickup) * MODEL.roadFactor;
      deliveryKm = haversineKm(pickup, order) * MODEL.roadFactor;

      etaMinutes = Math.ceil(
        (pickupKm + deliveryKm) / MODEL.speedKmh * 60 +
        MODEL.pickupMinutes +
        activeOrders * MODEL.minutesPerActiveOrder
      );

      lateMinutes = Math.max(
        0,
        Math.ceil((now + etaMinutes * 60000 - deadline) / 60000)
      );

      score = Number((
        pickupKm +
        activeOrders * MODEL.workloadPenalty +
        lateMinutes * MODEL.lateMinutePenalty
      ).toFixed(2));

      pickupKm = Number(pickupKm.toFixed(2));
      deliveryKm = Number(deliveryKm.toFixed(2));
    }

    return {
      ...driver,
      eligible: reasons.length === 0,
      reasons,
      pickup_km: pickupKm,
      delivery_km: deliveryKm,
      eta_minutes: etaMinutes,
      late_minutes: lateMinutes,
      score,
      explanation: score === null
        ? "Insufficient information to calculate a score."
        : `Score = pickup km + 4 × active orders + 2 × predicted late minutes. Lower is better.`,
    };
  });

  candidates.sort((a, b) =>
    Number(b.eligible) - Number(a.eligible) ||
    (a.score ?? Infinity) - (b.score ?? Infinity) ||
    Number(a.id) - Number(b.id)
  );

  return candidates;
}

module.exports = { MODEL, haversineKm, recommendDrivers };