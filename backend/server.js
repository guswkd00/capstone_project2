"use strict";

const path = require("node:path");
const express = require("express");

const { pool } = require("./src/db");

const {
  router: authRouter,
  requireLogin,
  requireManager,
  requireCsrf,
} = require("./src/auth");

const ordersRouter = require("./src/orders");
const fleetRouter = require("./src/fleet");
const dispatchRouter = require("./src/dispatch");
const driverRouter = require("./src/driver");
const reportsRouter = require("./src/reports");
const managerAIRouter = require("./src/manager-ai");

const {
  createWorkspaceRouter,
} = require("./src/driver-workspace");

const {
  createManagerNotificationsRouter,
} = require("./src/manager-notifications");
const {
  createManagerReportsRouter,
} = require("./src/manager-reports");

const {
  createManagerReportDraftsRouter,
} = require("./src/manager-report-drafts");

const app = express();

app.disable("x-powered-by");

if (process.env.TRUST_PROXY === "1") {
  app.set("trust proxy", 1);
}

app.use(express.json({ limit: "2mb" }));

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");

    res.json({
      status: "ok",
    });
  } catch (error) {
    res.status(503).json({
      message: "Database is unavailable.",
    });
  }
});

app.use("/api/auth", authRouter);

function protectWrites(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  return requireCsrf(req, res, next);
}

app.use(
  "/api/orders",
  requireLogin,
  requireManager,
  protectWrites,
  ordersRouter
);

app.use(
  "/api/fleet",
  requireLogin,
  requireManager,
  protectWrites,
  fleetRouter
);

app.use(
  "/api/dispatch",
  requireLogin,
  requireManager,
  protectWrites,
  dispatchRouter
);

app.use(
  "/api/driver",
  requireLogin,
  protectWrites,
  driverRouter
);

app.use(
  "/api/reports",
  requireLogin,
  requireManager,
  protectWrites,
  reportsRouter
);

app.use(
  "/api/manager-ai",
  requireLogin,
  requireManager,
  protectWrites,
  managerAIRouter
);

// Manager-only wallet reviews and order support messages.
app.use(
  "/api/driver-support",
  requireLogin,
  requireManager,
  protectWrites,
  createWorkspaceRouter(pool, {
    manager: true,
  })
);

// Manager-owned notifications; all writes require CSRF protection.
app.use(
  "/api/manager-notifications",
  requireLogin,
  requireManager,
  protectWrites,
  createManagerNotificationsRouter(pool)
);

// Protect the Driver page using the existing session.
app.get(
  "/driver.html",
  requireLogin,
  (req, res, next) => {
    if (req.user.role !== "driver") {
      return res.redirect("/account.html");
    }

    res.set("Cache-Control", "no-store");
    next();
  }
);
// Manager-owned reports and draft generation.
app.use(
  "/api/manager-reports",
  requireLogin,
  requireManager,
  protectWrites,
  createManagerReportDraftsRouter(pool),
  createManagerReportsRouter(pool)
);
app.use(
  express.static(path.join(__dirname, "public"))
);

app.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  console.error(
    "Request failed:",
    error.code || error.name
  );

  const status = error.status === 400 ? 400 : 500;

  res.status(status).json({
    message:
      status === 400
        ? "Invalid request body."
        : "An unexpected server error occurred.",
  });
});

async function start() {
  try {
    await pool.query("SELECT 1");

    const port = Number(process.env.PORT || 3000);
    const host = process.env.HOST || "127.0.0.1";

    const server = app.listen(port, host, () => {
      console.log(`Server running on port ${port}.`);
      console.log("MySQL connected successfully.");
    });

    server.on("error", async (error) => {
      console.error(
        "Server failed to start:",
        error.code
      );

      await pool.end();
      process.exitCode = 1;
    });

    for (const signal of ["SIGINT", "SIGTERM"]) {
      process.once(signal, () => {
        server.close(async () => {
          await pool.end();
          process.exit(0);
        });
      });
    }
  } catch (error) {
    console.error(
      "MySQL connection failed:",
      error.code
    );

    await pool.end();
    process.exitCode = 1;
  }
}

if (require.main === module) {
  start();
}

module.exports = {
  app,
  start,
};
