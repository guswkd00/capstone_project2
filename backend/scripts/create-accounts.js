const { pool } = require("../src/db");
const { hashPassword } = require("../src/security");

async function createAccounts() {
  const password = process.env.APP_SEED_PASSWORD;

  if (
    !password ||
    password.length < 12 ||
    password.length > 200 ||
    password.trim() !== password
  ) {
    throw new Error(
      "Set APP_SEED_PASSWORD to 12–200 characters, without surrounding spaces."
    );
  }

  const connection = await pool.getConnection();
  const accounts = [];

  try {
    await connection.beginTransaction();

    async function ensureAccount(email, fullName, role) {
      const [existing] = await connection.execute(
        "SELECT id, role FROM users WHERE email = ?",
        [email]
      );

      if (existing.length) {
        if (existing[0].role !== role) {
          throw new Error(
            `An existing account has a different role: ${email}`
          );
        }

        return existing[0].id;
      }

      const passwordHash = await hashPassword(password);

      const [result] = await connection.execute(
        `
          INSERT INTO users (
            email,
            full_name,
            password_hash,
            role
          )
          VALUES (?, ?, ?, ?)
        `,
        [email, fullName, passwordHash, role]
      );

      return result.insertId;
    }

    await ensureAccount(
      "manager@demo.local",
      "Demo Manager",
      "manager"
    );

    accounts.push({
      email: "manager@demo.local",
      role: "manager",
      driver: "—",
    });

    const [drivers] = await connection.execute(`
      SELECT id, driver_code, full_name, user_id
      FROM drivers
      ORDER BY driver_code
    `);

    for (const driver of drivers) {
      const email =
        `${driver.driver_code.toLowerCase()}@demo.local`;

      const userId = await ensureAccount(
        email,
        driver.full_name,
        "driver"
      );

      if (driver.user_id !== null && driver.user_id !== userId) {
        throw new Error(
          `Driver ${driver.driver_code} is already linked to another account.`
        );
      }

      await connection.execute(
        "UPDATE drivers SET user_id = ? WHERE id = ?",
        [userId, driver.id]
      );

      accounts.push({
        email,
        role: "driver",
        driver: driver.driver_code,
      });
    }

    await connection.commit();

    console.log("Application accounts are ready.");
    console.table(accounts);
    console.log(
      "New accounts use your private APP_SEED_PASSWORD."
    );
    console.log(
      "Existing accounts keep their current passwords."
    );
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

createAccounts()
  .catch(error => {
    console.error("Account setup failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());