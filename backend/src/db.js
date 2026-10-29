const path = require("node:path");
const dotenv = require("dotenv");
const mysql = require("mysql2/promise");

dotenv.config({
  path: path.resolve(__dirname, "../.env"),
  quiet: true,
  override: false,
});

const target = process.env.DATABASE_TARGET || "local";

if (!["local", "tidb"].includes(target)) {
  throw new Error("DATABASE_TARGET must be local or tidb.");
}

const useTidb = target === "tidb";

function required(name) {
  const value = process.env[name];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing database setting: ${name}`);
  }

  return value;
}

const port = Number(
  useTidb
    ? required("TIDB_PORT")
    : process.env.DB_PORT || 3306
);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Invalid database port.");
}

const pool = mysql.createPool({
  host: useTidb
    ? required("TIDB_HOST")
    : process.env.DB_HOST || "127.0.0.1",

  port,

  user: useTidb
    ? required("TIDB_USER")
    : required("DB_USER"),

  password: useTidb
    ? required("TIDB_PASSWORD")
    : required("DB_PASSWORD"),

  database: useTidb
    ? required("TIDB_DATABASE")
    : required("DB_NAME"),

  charset: "utf8mb4",
  timezone: "Z",

  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
  connectTimeout: 15000,

  ...(useTidb
    ? {
        ssl: {
          minVersion: "TLSv1.2",
          rejectUnauthorized: true,
        },
      }
    : {}),
});

pool.on("connection", (connection) => {
  const setupSql = useTidb
    ? "SET time_zone = '+00:00', tidb_txn_mode = 'pessimistic'"
    : "SET time_zone = '+00:00'";

  connection.query(setupSql, (error) => {
    if (error) {
      console.error(
        "Database session setup failed:",
        error.code || error.name
      );

      connection.destroy();
    }
  });
});

module.exports = { pool };