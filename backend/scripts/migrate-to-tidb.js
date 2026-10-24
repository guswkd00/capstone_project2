const path = require("node:path");
const dotenv = require("dotenv");
const mysql = require("mysql2/promise");
const { pool } = require("../src/db");

const tables = [
  "zones",
  "vehicles",
  "users",
  "drivers",
  "restaurants",
  "orders",
  "order_items",
  "order_events",
  "dispatch_history",
];

function quote(name) {
  return "`" + name.replace(/`/g, "``") + "`";
}

function databaseValue(value) {
  if (value == null) return null;

  if (value instanceof Date) {
    return value
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");
  }

  if (typeof value === "object" && !Buffer.isBuffer(value)) {
    return JSON.stringify(value);
  }

  return value;
}

async function main() {
  let source;
  let target;
  let sourceTransaction = false;
  let targetTransaction = false;

  const results = [];

  try {
    const config = dotenv.config({
      path: path.resolve(__dirname, "../.env.tidb"),
      quiet: true,
    });

    if (config.error) {
      throw new Error("Unable to read backend/.env.tidb.");
    }

    for (const name of [
      "TIDB_HOST",
      "TIDB_PORT",
      "TIDB_USER",
      "TIDB_PASSWORD",
      "TIDB_DATABASE",
    ]) {
      if (!process.env[name]) {
        throw new Error(`Missing setting: ${name}`);
      }
    }

    const port = Number(process.env.TIDB_PORT);

    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Invalid TIDB_PORT.");
    }

    if (process.env.TIDB_DATABASE !== "shopeefood_db") {
      throw new Error("Target database must be shopeefood_db.");
    }

    // Source: existing local MySQL configuration from src/db.js.
    source = await pool.getConnection();

    await source.query("SET time_zone = '+00:00'");

    const [sourceInfo] = await source.query(
      "SELECT DATABASE() AS db, VERSION() AS version"
    );

    if (
      sourceInfo[0].db !== "shopeefood_db" ||
      /tidb/i.test(sourceInfo[0].version)
    ) {
      throw new Error(
        "Source must be your local MySQL shopeefood_db."
      );
    }

    // Target: TiDB configuration, using verified TLS.
    target = await mysql.createConnection({
      host: process.env.TIDB_HOST,
      port,
      user: process.env.TIDB_USER,
      password: process.env.TIDB_PASSWORD,
      database: process.env.TIDB_DATABASE,
      charset: "utf8mb4",
      timezone: "Z",
      connectTimeout: 15000,
      ssl: {
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
      },
    });

    await target.query("SET time_zone = '+00:00'");

    const [targetInfo] = await target.query(
      "SELECT DATABASE() AS db, VERSION() AS version"
    );

    if (
      targetInfo[0].db !== "shopeefood_db" ||
      !/tidb/i.test(targetInfo[0].version)
    ) {
      throw new Error("Target must be TiDB shopeefood_db.");
    }

    await source.query(
      "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"
    );

    sourceTransaction = true;

    await target.beginTransaction();
    targetTransaction = true;

    // Check every target table before inserting anything.
    for (const table of [...tables, "sessions"]) {
      const [rows] = await target.query(
        `SELECT COUNT(*) AS total FROM ${quote(table)}`
      );

      if (Number(rows[0].total) !== 0) {
        throw new Error(
          `Target table ${table} is not empty. Migration stopped.`
        );
      }
    }

    for (const table of tables) {
      const [sourceColumns] = await source.query(
        `SHOW COLUMNS FROM ${quote(table)}`
      );

      const [targetColumns] = await target.query(
        `SHOW COLUMNS FROM ${quote(table)}`
      );

      const columns = sourceColumns.map(
        (column) => column.Field
      );

      const targetNames = targetColumns.map(
        (column) => column.Field
      );

      if (
        columns.length !== targetNames.length ||
        columns.some((name) => !targetNames.includes(name))
      ) {
        throw new Error(
          `Column mismatch in ${table}. Migration stopped.`
        );
      }

      const [rows] = await source.query({
        sql: `SELECT * FROM ${quote(table)} ORDER BY id`,
        dateStrings: true,
      });

      const insertSql =
        `INSERT INTO ${quote(table)} ` +
        `(${columns.map(quote).join(", ")}) VALUES ` +
        `(${columns.map(() => "?").join(", ")})`;

      for (const row of rows) {
        await target.execute(
          insertSql,
          columns.map((name) => databaseValue(row[name]))
        );
      }

      const [count] = await target.query(
        `SELECT COUNT(*) AS total FROM ${quote(table)}`
      );

      if (Number(count[0].total) !== rows.length) {
        throw new Error(
          `Row count mismatch in ${table}. Migration stopped.`
        );
      }

      results.push({
        table,
        local_rows: rows.length,
        tidb_rows: Number(count[0].total),
      });
    }

    await source.commit();
    sourceTransaction = false;

    await target.commit();
    targetTransaction = false;

    console.log("Migration completed successfully.");
    console.table(results);

    console.log(
      "Local data was not modified. Login sessions were not copied."
    );
  } catch (error) {
    if (source && sourceTransaction) {
      try {
        await source.rollback();
      } catch (rollbackError) {
        console.error(
          "Source rollback failed:",
          rollbackError.code
        );
      }
    }

    if (target && targetTransaction) {
      try {
        await target.rollback();
      } catch (rollbackError) {
        console.error(
          "Target rollback failed:",
          rollbackError.code
        );
      }
    }

    // Do not print database rows, passwords or connection strings.
    console.error(
      "Migration failed:",
      error.code || error.message
    );

    process.exitCode = 1;
  } finally {
    if (source) source.release();
    if (target) await target.end();

    await pool.end();
  }
}

main();