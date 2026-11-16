"use strict";

const { MODEL, haversineKm } = require("./dss");

function error(status, message) {
  return Object.assign(new Error(message), { status });
}

function integer(value, min, max, label) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw error(
      400,
      `${label} must be an integer from ${min} to ${max}.`
    );
  }

  return value;
}

function configured(name, fallback, min, max) {
  const value =
    process.env[name] === undefined
      ? fallback
      : Number(process.env[name]);

  return integer(value, min, max, name);
}

function policy() {
  return {
    max_delivery_km: configured(
      "DRIVER_MAX_DELIVERY_KM",
      10,
      1,
      200
    ),

    points_per_delivery: configured(
      "DRIVER_POINTS_PER_DELIVERY",
      20,
      0,
      1000
    ),

    tiers: [
      {
        points: 100,
        bonus: configured(
          "DRIVER_BONUS_100",
          50000,
          0,
          10000000
        ),
      },
      {
        points: 180,
        bonus: configured(
          "DRIVER_BONUS_180",
          120000,
          0,
          10000000
        ),
      },
      {
        points: 250,
        bonus: configured(
          "DRIVER_BONUS_250",
          220000,
          0,
          10000000
        ),
      },
    ],
  };
}

function rewardFor(points, config = policy()) {
  return {
    points: config.points_per_delivery,

    bonus: config.tiers
      .filter(
        (tier) =>
          points < tier.points &&
          points + config.points_per_delivery >= tier.points
      )
      .reduce((sum, tier) => sum + tier.bonus, 0),
  };
}

function deliveryDistance(order) {
  const pickup = {
    latitude: order.pickup_latitude,
    longitude: order.pickup_longitude,
  };

  for (const point of [pickup, order]) {
    if (
      point.latitude == null ||
      point.longitude == null ||
      !Number.isFinite(Number(point.latitude)) ||
      !Number.isFinite(Number(point.longitude)) ||
      Math.abs(Number(point.latitude)) > 90 ||
      Math.abs(Number(point.longitude)) > 180
    ) {
      throw error(
        409,
        "Valid pickup and delivery coordinates are required."
      );
    }
  }

  return haversineKm(pickup, order) * MODEL.roadFactor;
}

function validateRequest(body) {
  if (
    !body ||
    !["withdrawal", "topup"].includes(body.request_type)
  ) {
    throw error(400, "Invalid wallet request type.");
  }

  integer(body.amount, 10000, 10000000, "Amount");
  uuid(body.request_key);
}

function uuid(value) {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      value
    )
  ) {
    throw error(400, "A valid request key is required.");
  }
}

module.exports = {
  error,
  integer,
  policy,
  rewardFor,
  deliveryDistance,
  validateRequest,
  uuid,
};
