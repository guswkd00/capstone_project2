const express = require("express");
const { pool } = require("./db");

const router = express.Router();

// Get drivers with their zone and vehicle information.
router.get("/drivers", async (req, res) => {
  try {
    const [drivers] = await pool.execute(`
      SELECT
        d.id,
        d.driver_code,
        d.full_name,
        d.phone,
        d.zone_id,
        d.vehicle_id,
        d.status,
        d.latitude,
        d.longitude,
        z.name AS service_zone,
        v.plate_number,
        v.capacity_kg,
        v.status AS vehicle_status
      FROM drivers d
      JOIN zones z ON z.id = d.zone_id
      JOIN vehicles v ON v.id = d.vehicle_id
      ORDER BY d.driver_code
    `);

    res.json({ data: drivers });
  } catch (error) {
    console.error("Drivers query failed:", error.code);
    res.status(500).json({
      message: "Unable to retrieve drivers.",
    });
  }
});

// Get vehicles.
router.get("/vehicles", async (req, res) => {
  try {
    const [vehicles] = await pool.execute(`
      SELECT
        id,
        plate_number,
        vehicle_type,
        capacity_kg,
        cost_per_km,
        status,
        maintenance_due
      FROM vehicles
      ORDER BY plate_number
    `);

    res.json({ data: vehicles });
  } catch (error) {
    console.error("Vehicles query failed:", error.code);
    res.status(500).json({
      message: "Unable to retrieve vehicles.",
    });
  }
});

// Get pickup hubs and service zones.
router.get("/zones", async (req, res) => {
  try {
    const [zones] = await pool.execute(`
      SELECT id, name, latitude, longitude, active
      FROM zones
      ORDER BY name
    `);

    res.json({ data: zones });
  } catch (error) {
    console.error("Zones query failed:", error.code);
    res.status(500).json({
      message: "Unable to retrieve service zones.",
    });
  }
});
// Validate vehicle information.
function validateVehicle(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Vehicle information is required." };
  }

  const plate = typeof body.plate_number === "string"
    ? body.plate_number.trim().toUpperCase()
    : "";

  if (!plate || plate.length > 30) {
    return { error: "License plate must contain 1–30 characters." };
  }

  if (!["motorbike", "van"].includes(body.vehicle_type)) {
    return { error: "Vehicle type must be motorbike or van." };
  }

  if (!["available", "maintenance", "inactive"].includes(body.status)) {
    return { error: "Invalid vehicle status." };
  }

  const rawCapacity = body.capacity_kg;
  const rawCost = body.cost_per_km;

  if (
    !["number", "string"].includes(typeof rawCapacity) ||
    String(rawCapacity).trim() === ""
  ) {
    return { error: "Capacity is required." };
  }

  const capacity = Number(rawCapacity);

  if (
    !Number.isFinite(capacity) ||
    capacity <= 0 ||
    capacity > 100000 ||
    Math.abs(capacity * 100 - Math.round(capacity * 100)) > 0.000001
  ) {
    return {
      error: "Capacity must be greater than 0, at most 100,000 kg, with up to 2 decimal places.",
    };
  }

  if (
    !["number", "string"].includes(typeof rawCost) ||
    String(rawCost).trim() === ""
  ) {
    return { error: "Cost per km is required." };
  }

  const cost = Number(rawCost);

  if (!Number.isSafeInteger(cost) || cost < 0 || cost > 1000000) {
    return {
      error: "Cost per km must be a whole VND amount from 0 to 1,000,000.",
    };
  }

  const maintenanceDue = body.maintenance_due;

  if (
    typeof maintenanceDue !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(maintenanceDue)
  ) {
    return { error: "Maintenance date must use YYYY-MM-DD." };
  }

  const parsedDate = new Date(`${maintenanceDue}T00:00:00Z`);

  if (
    !Number.isFinite(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== maintenanceDue
  ) {
    return { error: "Invalid maintenance date." };
  }

  return {
    values: [
      plate,
      body.vehicle_type,
      capacity,
      cost,
      body.status,
      maintenanceDue,
    ],
  };
}

// Add a vehicle.
router.post("/vehicles", async (req, res) => {
  const validation = validateVehicle(req.body);

  if (validation.error) {
    return res.status(400).json({
      message: validation.error,
    });
  }

  try {
    const [result] = await pool.execute(
      `
        INSERT INTO vehicles (
          plate_number,
          vehicle_type,
          capacity_kg,
          cost_per_km,
          status,
          maintenance_due
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      validation.values
    );

    res.status(201).json({
      message: "Vehicle created successfully.",
      data: { id: result.insertId },
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "This license plate already exists.",
      });
    }

    console.error("Vehicle creation failed:", error.code);
    res.status(500).json({
      message: "Unable to create the vehicle.",
    });
  }
});

// Edit a vehicle.
router.put("/vehicles/:id", async (req, res) => {
  const vehicleId = Number(req.params.id);

  if (!Number.isSafeInteger(vehicleId) || vehicleId <= 0) {
    return res.status(400).json({
      message: "Invalid vehicle ID.",
    });
  }

  const validation = validateVehicle(req.body);

  if (validation.error) {
    return res.status(400).json({
      message: validation.error,
    });
  }

  try {
    const [existing] = await pool.execute(
      "SELECT id FROM vehicles WHERE id = ?",
      [vehicleId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        message: "Vehicle not found.",
      });
    }

    await pool.execute(
      `
        UPDATE vehicles
        SET
          plate_number = ?,
          vehicle_type = ?,
          capacity_kg = ?,
          cost_per_km = ?,
          status = ?,
          maintenance_due = ?
        WHERE id = ?
      `,
      [...validation.values, vehicleId]
    );

    res.json({
      message: "Vehicle updated successfully.",
      data: { id: vehicleId },
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "This license plate already exists.",
      });
    }

    console.error("Vehicle update failed:", error.code);
    res.status(500).json({
      message: "Unable to update the vehicle.",
    });
  }
});
// Create login accounts for unlinked scale-demo drivers.
// Manager authentication and CSRF are enforced in server.js.
router.post("/demo-driver-accounts", async (req, res) => {
  const { hashPassword } = require("./security");

  const emailBase = String(
    req.body?.email_base || req.user.email || ""
  ).trim().toLowerCase();

  const password = req.body?.password;

  if (!/^[a-z0-9.]+@gmail\.com$/.test(emailBase)) {
    return res.status(400).json({
      message: "Enter your base Gmail address without a +alias."
    });
  }

  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 200 ||
    password.trim() !== password
  ) {
    return res.status(400).json({
      message:
        "Choose an initial password of 12–200 characters without surrounding spaces."
    });
  }

  let connection;

  try {
    const [drivers] = await pool.execute(`
      SELECT id, driver_code, full_name
      FROM drivers
      WHERE user_id IS NULL
        AND driver_code REGEXP '^DEMO-SCALE-D[0-9]{3}$'
      ORDER BY driver_code
      LIMIT 60
    `);

    const prepared = [];

    for (const driver of drivers) {
      const suffix = driver.driver_code.slice(-3);

      prepared.push({
        ...driver,
        email: emailBase.replace("@", "+demo" + suffix + "@"),
        passwordHash: await hashPassword(password)
      });
    }

    connection = await pool.getConnection();
    await connection.beginTransaction();

    const accounts = [];

    for (const driver of prepared) {
      const [current] = await connection.execute(
        "SELECT user_id FROM drivers WHERE id = ? FOR UPDATE",
        [driver.id]
      );

      if (!current.length || current[0].user_id !== null) {
        continue;
      }

      const [existing] = await connection.execute(
        "SELECT id FROM users WHERE email = ?",
        [driver.email]
      );

      if (existing.length) {
        const error = new Error(
          "A generated email already exists. No accounts were changed."
        );

        error.status = 409;
        throw error;
      }

      const [created] = await connection.execute(
        `
          INSERT INTO users (
            email,
            full_name,
            password_hash,
            role,
            active
          )
          VALUES (?, ?, ?, 'driver', 1)
        `,
        [
          driver.email,
          driver.full_name,
          driver.passwordHash
        ]
      );

      await connection.execute(
        "UPDATE drivers SET user_id = ? WHERE id = ?",
        [created.insertId, driver.id]
      );

      accounts.push({
        driver_code: driver.driver_code,
        full_name: driver.full_name,
        email: driver.email
      });
    }

    await connection.commit();

    res.status(201).json({
      message: `Created ${accounts.length} demo driver accounts.`,
      accounts
    });
  } catch (error) {
    if (connection) await connection.rollback();

    console.error(
      "Demo account creation failed:",
      error.code || error.name
    );

    res.status(error.status || 500).json({
      message: error.status
        ? error.message
        : "Unable to create demo driver accounts."
    });
  } finally {
    if (connection) connection.release();
  }
});
// Manager access is enforced in server.js.
router.get("/vehicles/:id/expenses", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  const vehicleId = Number(req.params.id);

  if (!Number.isSafeInteger(vehicleId) || vehicleId <= 0) {
    return res.status(400).json({
      message: "Invalid vehicle ID."
    });
  }

  try {
    const [vehicles] = await pool.execute(
      "SELECT id, plate_number FROM vehicles WHERE id = ?",
      [vehicleId]
    );

    if (!vehicles.length) {
      return res.status(404).json({
        message: "Vehicle not found."
      });
    }

    const [expenses] = await pool.execute(
      `SELECT
         e.id,
         e.expense_type,
         e.amount,
         DATE_FORMAT(e.expense_date, '%Y-%m-%d') AS expense_date,
         e.description,
         e.created_at,
         u.full_name AS recorded_by
       FROM vehicle_expenses e
       JOIN users u ON u.id = e.created_by
       WHERE e.vehicle_id = ?
       ORDER BY e.expense_date DESC, e.id DESC
       LIMIT 200`,
      [vehicleId]
    );

    return res.json({
      vehicle: vehicles[0],
      data: expenses,
      limit: 200
    });
  } catch (error) {
    console.error("Vehicle expenses query failed:", error.code);

    return res.status(500).json({
      message: "Unable to retrieve vehicle expenses."
    });
  }
});
// Manager access is enforced in server.js.
router.get("/maintenance-alerts", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  try {
    const [vehicles] = await pool.execute(
      `SELECT
         id,
         plate_number,
         status,
         DATE_FORMAT(maintenance_due, '%Y-%m-%d') AS maintenance_due,
         DATEDIFF(
           maintenance_due,
           DATE(UTC_TIMESTAMP() + INTERVAL 7 HOUR)
         ) AS days_until_due
       FROM vehicles
       WHERE status = 'maintenance'
          OR (
            status = 'available'
            AND maintenance_due <= DATE(
              UTC_TIMESTAMP() + INTERVAL 7 HOUR
            ) + INTERVAL 7 DAY
          )
       ORDER BY
         (status = 'maintenance') DESC,
         maintenance_due ASC,
         plate_number ASC`
    );

    const data = vehicles.map(vehicle => {
      let alert;

      if (vehicle.status === "maintenance") {
        alert = "In maintenance";
      } else if (Number(vehicle.days_until_due) < 0) {
        alert = "Maintenance overdue";
      } else if (Number(vehicle.days_until_due) === 0) {
        alert = "Maintenance due today";
      } else {
        alert = "Maintenance due soon";
      }

      return { ...vehicle, alert };
    });

    return res.json({ data });
  } catch (error) {
    console.error("Maintenance alerts query failed:", error.code);

    return res.status(500).json({
      message: "Unable to retrieve maintenance alerts."
    });
  }
});
module.exports = router;
// Validate driver information.
function validateDriver(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Driver information is required." };
  }

  const driverCode = typeof body.driver_code === "string"
    ? body.driver_code.trim().toUpperCase()
    : "";

  const fullName = typeof body.full_name === "string"
    ? body.full_name.trim()
    : "";

  const phone = typeof body.phone === "string"
    ? body.phone.trim()
    : "";

  if (
    !driverCode ||
    driverCode.length > 30 ||
    !/^[A-Z0-9_-]+$/.test(driverCode)
  ) {
    return {
      error: "Driver code must contain 1–30 letters, numbers, - or _.",
    };
  }

  if (!fullName || fullName.length > 100) {
    return { error: "Full name must contain 1–100 characters." };
  }

  if (!/^\+?[0-9]{8,15}$/.test(phone)) {
    return {
      error: "Phone must contain 8–15 digits, optionally starting with +.",
    };
  }

  if (!["available", "offline"].includes(body.status)) {
    return { error: "Driver status must be available or offline." };
  }

  function readNumber(value) {
    if (
      !["number", "string"].includes(typeof value) ||
      String(value).trim() === ""
    ) {
      return null;
    }

    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  const zoneId = readNumber(body.zone_id);
  const vehicleId = readNumber(body.vehicle_id);
  const latitude = readNumber(body.latitude);
  const longitude = readNumber(body.longitude);

  if (!Number.isSafeInteger(zoneId) || zoneId <= 0) {
    return { error: "Select a valid service zone." };
  }

  if (!Number.isSafeInteger(vehicleId) || vehicleId <= 0) {
    return { error: "Select a valid vehicle." };
  }

  if (latitude === null || latitude < -90 || latitude > 90) {
    return { error: "Latitude must be between -90 and 90." };
  }

  if (longitude === null || longitude < -180 || longitude > 180) {
    return { error: "Longitude must be between -180 and 180." };
  }

  return {
    data: {
      driverCode,
      fullName,
      phone,
      zoneId,
      vehicleId,
      status: body.status,
      latitude,
      longitude,
    },
  };
}

// Check the selected service zone and vehicle.
async function checkDriverLinks(data) {
  const [zones] = await pool.execute(
    "SELECT id FROM zones WHERE id = ? AND active = 1",
    [data.zoneId]
  );

  if (zones.length === 0) {
    return "The selected service zone is missing or inactive.";
  }

  const [vehicles] = await pool.execute(
    "SELECT id, status FROM vehicles WHERE id = ?",
    [data.vehicleId]
  );

  if (vehicles.length === 0) {
    return "The selected vehicle does not exist.";
  }

  if (
    data.status === "available" &&
    vehicles[0].status !== "available"
  ) {
    return "An available driver must have an available vehicle.";
  }

  return null;
}

// Add a driver.
router.post("/drivers", async (req, res) => {
  const validation = validateDriver(req.body);

  if (validation.error) {
    return res.status(400).json({
      message: validation.error,
    });
  }

  const data = validation.data;

  try {
    const linkError = await checkDriverLinks(data);

    if (linkError) {
      return res.status(400).json({ message: linkError });
    }

    const [result] = await pool.execute(
      `
        INSERT INTO drivers (
          driver_code,
          full_name,
          phone,
          zone_id,
          vehicle_id,
          status,
          latitude,
          longitude
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        data.driverCode,
        data.fullName,
        data.phone,
        data.zoneId,
        data.vehicleId,
        data.status,
        data.latitude,
        data.longitude,
      ]
    );

    res.status(201).json({
      message: "Driver created successfully.",
      data: { id: result.insertId },
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Driver code already exists or this vehicle is assigned to another driver.",
      });
    }

    if (error.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(409).json({
        message: "The selected zone or vehicle no longer exists.",
      });
    }

    console.error("Driver creation failed:", error.code);
    res.status(500).json({
      message: "Unable to create the driver.",
    });
  }
});

// Edit a driver.
router.put("/drivers/:id", async (req, res) => {
  const driverId = Number(req.params.id);

  if (!Number.isSafeInteger(driverId) || driverId <= 0) {
    return res.status(400).json({
      message: "Invalid driver ID.",
    });
  }

  const validation = validateDriver(req.body);

  if (validation.error) {
    return res.status(400).json({
      message: validation.error,
    });
  }

  const data = validation.data;

  try {
    const [existing] = await pool.execute(
      "SELECT id FROM drivers WHERE id = ?",
      [driverId]
    );

    if (existing.length === 0) {
      return res.status(404).json({
        message: "Driver not found.",
      });
    }

    const linkError = await checkDriverLinks(data);

    if (linkError) {
      return res.status(400).json({ message: linkError });
    }

    await pool.execute(
      `
        UPDATE drivers
        SET
          driver_code = ?,
          full_name = ?,
          phone = ?,
          zone_id = ?,
          vehicle_id = ?,
          status = ?,
          latitude = ?,
          longitude = ?
        WHERE id = ?
      `,
      [
        data.driverCode,
        data.fullName,
        data.phone,
        data.zoneId,
        data.vehicleId,
        data.status,
        data.latitude,
        data.longitude,
        driverId,
      ]
    );

    res.json({
      message: "Driver updated successfully.",
      data: { id: driverId },
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        message: "Driver code already exists or this vehicle is assigned to another driver.",
      });
    }

    if (error.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(409).json({
        message: "The selected zone or vehicle no longer exists.",
      });
    }

    console.error("Driver update failed:", error.code);
    res.status(500).json({
      message: "Unable to update the driver.",
    });
  }
});
