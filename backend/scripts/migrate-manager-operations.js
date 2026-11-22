"use strict";

// Explicit invocation only.
// Never import this runner from server startup.

const { pool } = require("../src/db");

const {
  migrate,
} = require("../migrations/021-manager-operations");

(async () => {
  try {
    await migrate(pool);

    console.log(
      "Migration 021-manager-operations completed."
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
