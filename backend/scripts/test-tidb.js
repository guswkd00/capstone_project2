const path = require("node:path");
const dotenv = require("dotenv");
const mysql = require("mysql2/promise");

async function main() {
  let connection;

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
      throw new Error("TIDB_DATABASE must be shopeefood_db.");
    }

    connection = await mysql.createConnection({
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

    const [rows] = await connection.execute(`
      SELECT
        DATABASE() AS database_name,
        VERSION() AS server_version,
        (
          SELECT COUNT(*)
          FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_TYPE = 'BASE TABLE'
        ) AS table_count
    `);

    console.log("TiDB connection successful with TLS.");
    console.table(rows);
  } catch (error) {
    console.error(
      "TiDB connection test failed:",
      error.code || "CONFIGURATION_ERROR"
    );

    if (!error.code) {
      console.error(error.message);
    }

    process.exitCode = 1;
  } finally {
    if (connection) await connection.end();
  }
}

main();