const { MODEL, haversineKm } = require("./dss");

function validPoint(point) {
  return point &&
    point.latitude != null &&
    point.longitude != null &&
    point.latitude !== "" &&
    point.longitude !== "" &&
    Number.isFinite(Number(point.latitude)) &&
    Number.isFinite(Number(point.longitude)) &&
    Math.abs(Number(point.latitude)) <= 90 &&
    Math.abs(Number(point.longitude)) <= 180;
}

function planDriverRoute(driver, orders) {
  if (!validPoint(driver)) {
    throw new Error("Driver coordinates are missing or invalid.");
  }

  const pending = orders.map(order => {
    const delivery = {
      latitude: order.latitude,
      longitude: order.longitude,
      address: order.delivery_address
    };

    const pickup = {
      latitude: order.pickup_latitude,
      longitude: order.pickup_longitude,
      address: order.pickup_address
    };

    if (
      !validPoint(delivery) ||
      (!order.picked_up_at && !validPoint(pickup))
    ) {
      throw new Error(
        `Coordinates are missing for order ${order.order_code}.`
      );
    }

    return {
      order,
      pickup,
      delivery,
      pickedUp: Boolean(order.picked_up_at)
    };
  });

  let current = driver;
  let totalKm = 0;
  const stops = [];

  while (pending.length) {
    const options = pending.map(item => {
      const point = item.pickedUp ? item.delivery : item.pickup;

      return {
        item,
        point,
        km: haversineKm(current, point) * MODEL.roadFactor
      };
    });

    options.sort((a, b) =>
      a.km - b.km ||
      Number(a.item.order.id) - Number(b.item.order.id)
    );

    const next = options[0];
    const type = next.item.pickedUp ? "delivery" : "pickup";

    totalKm += next.km;

    stops.push({
      sequence: stops.length + 1,
      order_id: next.item.order.id,
      order_code: next.item.order.order_code,
      type,
      address: next.point.address,
      latitude: Number(next.point.latitude),
      longitude: Number(next.point.longitude),
      estimated_leg_km: Number(next.km.toFixed(2))
    });

    current = next.point;

    if (type === "pickup") {
      next.item.pickedUp = true;
    } else {
      pending.splice(pending.indexOf(next.item), 1);
    }
  }

  return {
    stops,
    estimated_total_km: Number(totalKm.toFixed(2)),
    estimated_travel_minutes:
      Math.ceil(totalKm / MODEL.speedKmh * 60),
    method: "Nearest available stop; pickup before delivery."
  };
}

module.exports = { planDriverRoute };
