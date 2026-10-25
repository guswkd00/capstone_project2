const express = require("express");
const { pool } = require("./db");

const router = express.Router();

router.get("/", async (req, res) => {
  let connection;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [summary] = await connection.execute(`
      SELECT
        COUNT(*) AS total_orders,

        COALESCE(SUM(
          status IN ('pending', 'confirmed')
        ), 0) AS waiting_orders,

        COALESCE(SUM(
          status IN ('assigned', 'delivering')
        ), 0) AS active_orders,

        COALESCE(SUM(status = 'completed'), 0) AS completed_orders,
        COALESCE(SUM(status = 'failed'), 0) AS failed_orders,
        COALESCE(SUM(status = 'cancelled'), 0) AS cancelled_orders,

        COALESCE(SUM(
          status = 'completed'
          AND due_at IS NOT NULL
          AND delivered_at IS NOT NULL
        ), 0) AS timed_completed_orders,

        COALESCE(SUM(
          status = 'completed'
          AND due_at IS NOT NULL
          AND delivered_at IS NOT NULL
          AND delivered_at <= due_at
        ), 0) AS on_time_orders,

        COALESCE(SUM(
          status IN ('pending', 'confirmed', 'assigned', 'delivering')
          AND due_at < UTC_TIMESTAMP()
        ), 0) AS overdue_open_orders,

        COALESCE(SUM(
          CASE WHEN status = 'completed'
          THEN cod_collected ELSE 0 END
        ), 0) AS recorded_cod_collected,

        COALESCE(SUM(
          CASE WHEN status IN ('assigned', 'delivering')
          THEN cod_amount ELSE 0 END
        ), 0) AS active_cod_required,

        COALESCE(SUM(
          status = 'completed' AND cod_collected IS NULL
        ), 0) AS missing_cod_records,

        COALESCE(SUM(
          status = 'completed'
          AND cod_collected IS NOT NULL
          AND cod_collected <> cod_amount
        ), 0) AS cod_mismatches,

        AVG(
          CASE WHEN status = 'completed'
            AND started_at IS NOT NULL
            AND delivered_at >= started_at
          THEN TIMESTAMPDIFF(
            SECOND, started_at, delivered_at
          ) / 60.0
          ELSE NULL END
        ) AS average_delivery_minutes

      FROM orders
    `);

    const [driverRows] = await connection.execute(`
      SELECT
        d.id,
        d.driver_code,
        d.full_name,
        d.status,

        COUNT(o.id) AS assigned_total,

        COALESCE(SUM(
          o.status IN ('assigned', 'delivering')
        ), 0) AS active_orders,

        COALESCE(SUM(
          o.status = 'completed'
        ), 0) AS completed_orders,

        COALESCE(SUM(
          o.status = 'failed'
        ), 0) AS failed_orders,

        COALESCE(SUM(
          o.status = 'completed'
          AND o.due_at IS NOT NULL
          AND o.delivered_at IS NOT NULL
        ), 0) AS timed_completed_orders,

        COALESCE(SUM(
          o.status = 'completed'
          AND o.due_at IS NOT NULL
          AND o.delivered_at IS NOT NULL
          AND o.delivered_at <= o.due_at
        ), 0) AS on_time_orders,

        COALESCE(SUM(
          CASE WHEN o.status = 'completed'
          THEN o.cod_collected ELSE 0 END
        ), 0) AS recorded_cod_collected

      FROM drivers d
      LEFT JOIN orders o ON o.driver_id = d.id

      GROUP BY
        d.id, d.driver_code, d.full_name, d.status

      ORDER BY completed_orders DESC, d.id
    `);

    const [recent] = await connection.execute(`
      SELECT
        o.id,
        o.order_code,
        o.customer_name,
        o.status,
        o.due_at,
        o.started_at,
        o.delivered_at,
        o.cod_amount,
        o.cod_collected,
        d.full_name AS driver_name,

        CASE
          WHEN o.status = 'completed'
            AND o.due_at IS NOT NULL
            AND o.delivered_at IS NOT NULL
          THEN
            CASE
              WHEN o.delivered_at <= o.due_at THEN 'On time'
              ELSE 'Late'
            END
          ELSE NULL
        END AS delivery_result

      FROM orders o
      LEFT JOIN drivers d ON d.id = o.driver_id

      ORDER BY
        COALESCE(
          o.delivered_at,
          o.started_at,
          o.assigned_at,
          o.created_at
        ) DESC,
        o.id DESC

      LIMIT 50
    `);
    const [fleetRows] = await connection.execute(`
      SELECT
        COUNT(DISTINCT v.id) AS total_vehicles,
        COUNT(DISTINCT CASE
          WHEN o.id IS NOT NULL THEN v.id
          ELSE NULL
        END) AS active_vehicles
      FROM vehicles v
      LEFT JOIN drivers d ON d.vehicle_id = v.id
      LEFT JOIN orders o
        ON o.driver_id = d.id
        AND o.status IN ('assigned', 'delivering')
    `);

    const totalVehicles = Number(fleetRows[0].total_vehicles);
    const activeVehicles = Number(fleetRows[0].active_vehicles);

    const fleetUtilization = totalVehicles > 0
      ? Math.round(activeVehicles / totalVehicles * 1000) / 10
      : null;
    await connection.commit();

    function withRate(row) {
      const timed = Number(row.timed_completed_orders);
      const onTime = Number(row.on_time_orders);

      return {
        ...row,
        on_time_rate:
          timed > 0
            ? Math.round((onTime / timed) * 1000) / 10
            : null,
      };
    }

    res.set("Cache-Control", "no-store");

    res.json({
      data: {
        generated_at: new Date().toISOString(),
        summary: withRate({
  ...summary[0],
  total_vehicles: totalVehicles,
  active_vehicles: activeVehicles,
  fleet_utilization_rate: fleetUtilization
}),
        drivers: driverRows.map(withRate),
        recent_orders: recent,
      },
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "Reports rollback failed:",
          rollbackError.code
        );
      }
    }

    console.error(
      "Reports query failed:",
      error.code || error.name
    );

    res.status(500).json({
      message: "Unable to retrieve delivery reports.",
    });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
