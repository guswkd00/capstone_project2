const fs = require("node:fs/promises");
const path = require("node:path");
const { pool } = require("../src/db");

async function main() {
  try {
    const [databaseRows] = await pool.query(
      "SELECT DATABASE() AS database_name"
    );

    if (databaseRows[0].database_name !== "shopeefood_db") {
      throw new Error(
        "The current database must be shopeefood_db."
      );
    }

    const [tables] = await pool.execute(`
      SELECT TABLE_NAME AS table_name
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_TYPE = 'BASE TABLE'
      ORDER BY TABLE_NAME
    `);

    const statements = [
      "-- Structure only. No table data or account passwords.",
      "-- Review for TiDB compatibility before importing.",
      "",
    ];

    for (const table of tables) {
      const escapedName =
        "`" + table.table_name.replace(/`/g, "``") + "`";

      const [rows] = await pool.query(
        `SHOW CREATE TABLE ${escapedName}`
      );

      statements.push(rows[0]["Create Table"] + ";", "");
    }

    const outputDirectory = path.resolve(__dirname, "../sql");
    const outputFile = path.join(
      outputDirectory,
      "shopeefood-schema.sql"
    );

    await fs.mkdir(outputDirectory, { recursive: true });
    await fs.writeFile(
      outputFile,
      statements.join("\n"),
      "utf8"
    );

    console.log(`Exported ${tables.length} table definitions.`);
    console.log(`Saved to: ${outputFile}`);
  } catch (error) {
    console.error(
      "Schema export failed:",
      error.code || error.message
    );

    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();