const express = require("express");
const { pool } = require("./db");

const {
  createToken,
  hashToken,
  hashPassword,
} = require("./security");

const {
  emailEnabled,
  applicationUrl,
  sendEmail,
  notify,
} = require("./mail");

const router = express.Router();
const attempts = new Map();

const genericMessage =
  "If an active account matches this email, a password reset " +
  "link will be sent. Check your inbox and spam folder.";

function limited(req, name) {
  const now = Date.now();

  for (const [key, record] of attempts) {
    if (record.until <= now) attempts.delete(key);
  }

  const key = `${name}:${req.ip}`;

  const record = attempts.get(key) || {
    count: 0,
    until: now + 15 * 60 * 1000,
  };

  if (record.count >= 10) return true;

  record.count++;
  attempts.set(key, record);

  return false;
}

async function issueReset(email) {
  let connection;
  let delivery;

  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    const [users] = await connection.execute(
      `
        SELECT id, email, full_name
        FROM users
        WHERE email = ? AND active = 1
        FOR UPDATE
      `,
      [email]
    );

    const user = users[0];

    if (!user) {
      await connection.rollback();
      return;
    }

    const [counts] = await connection.execute(
      `
        SELECT COUNT(*) AS total
        FROM password_reset_tokens
        WHERE user_id = ?
          AND created_at >
            DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)
      `,
      [user.id]
    );

    if (Number(counts[0].total) >= 3) {
      await connection.rollback();
      return;
    }

    await connection.execute(
      `
        DELETE FROM password_reset_tokens
        WHERE user_id = ?
          AND created_at <
            DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
      `,
      [user.id]
    );

    // Invalidate older links for this account.
    await connection.execute(
      `
        UPDATE password_reset_tokens
        SET used_at = UTC_TIMESTAMP()
        WHERE user_id = ? AND used_at IS NULL
      `,
      [user.id]
    );

    const token = createToken();

    await connection.execute(
      `
        INSERT INTO password_reset_tokens (
          token_hash,
          user_id,
          email_at_issue,
          expires_at
        )
        VALUES (
          ?, ?, ?,
          DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE)
        )
      `,
      [hashToken(token), user.id, user.email]
    );

    await connection.commit();

    delivery = { user, token };
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch {}
    }

    throw error;
  } finally {
    if (connection) connection.release();
  }

  if (delivery) {
    const { user, token } = delivery;

    const link = applicationUrl(
      `/reset-password.html#token=${token}`
    );

    await sendEmail(
      user.email,
      user.full_name,
      "Reset your password — ShopeeFood Delivery DSS",
      `Hello ${user.full_name},\n\n` +
        `Use this link to set a new password:\n${link}\n\n` +
        "This link expires in 30 minutes and can be used once. " +
        "Only the most recently requested link works.\n\n" +
        "If you did not request this, ignore this email. " +
        "Your password remains unchanged.\n\n" +
        "Academic prototype — not an official ShopeeFood service."
    );
  }
}

router.get("/email-status", (req, res) => {
  res.set("Cache-Control", "no-store");

  res.json({
    enabled: emailEnabled(),
  });
});

router.post("/forgot-password", (req, res) => {
  res.set("Cache-Control", "no-store");

  const email =
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";

  if (
    !email ||
    email.length > 150 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return res.status(400).json({
      message: "Enter a valid email address.",
    });
  }

  if (limited(req, "forgot")) {
    return res.status(429).json({
      message: "Too many requests. Try again in 15 minutes.",
    });
  }

  if (!emailEnabled()) {
    return res.status(503).json({
      message:
        "Email recovery is not configured yet. " +
        "Contact the administrator.",
    });
  }

  // Same response for registered and unregistered emails.
  res.json({ message: genericMessage });

  setImmediate(() => {
    issueReset(email).catch((error) => {
      console.error(
        "Password reset email failed:",
        error.code || error.name
      );
    });
  });
});

router.post("/reset-password", async (req, res) => {
  res.set("Cache-Control", "no-store");

  if (limited(req, "reset")) {
    return res.status(429).json({
      message: "Too many requests. Try again in 15 minutes.",
    });
  }

  const token = req.body?.token;
  const password = req.body?.password;

  const invalidLinkMessage =
    "This reset link is invalid or expired. Request a new link.";

  if (
    typeof token !== "string" ||
    !/^[a-f0-9]{64}$/.test(token)
  ) {
    return res.status(400).json({
      message: invalidLinkMessage,
    });
  }

  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 200 ||
    password !== password.trim()
  ) {
    return res.status(400).json({
      message:
        "Use 12–200 characters without surrounding spaces.",
    });
  }

  let connection;
  let user;

  try {
    const digest = hashToken(token);

    const [tokens] = await pool.execute(
      `
        SELECT user_id
        FROM password_reset_tokens
        WHERE token_hash = ?
          AND used_at IS NULL
          AND expires_at > UTC_TIMESTAMP()
      `,
      [digest]
    );

    if (!tokens.length) {
      return res.status(400).json({
        message: invalidLinkMessage,
      });
    }

    const passwordHash = await hashPassword(password);

    connection = await pool.getConnection();
    await connection.beginTransaction();

    // Lock the user before locking their reset token.
    const [users] = await connection.execute(
      `
        SELECT id, email, full_name, role
        FROM users
        WHERE id = ? AND active = 1
        FOR UPDATE
      `,
      [tokens[0].user_id]
    );

    user = users[0];

    const [valid] = await connection.execute(
      `
        SELECT email_at_issue
        FROM password_reset_tokens
        WHERE token_hash = ?
          AND user_id = ?
          AND used_at IS NULL
          AND expires_at > UTC_TIMESTAMP()
        FOR UPDATE
      `,
      [digest, tokens[0].user_id]
    );

    if (
      !user ||
      !valid.length ||
      valid[0].email_at_issue.toLowerCase() !==
        user.email.toLowerCase()
    ) {
      await connection.rollback();

      return res.status(400).json({
        message: invalidLinkMessage,
      });
    }

    await connection.execute(
      "UPDATE users SET password_hash = ? WHERE id = ?",
      [passwordHash, user.id]
    );

    // Consume this link and invalidate other outstanding links.
    await connection.execute(
      `
        UPDATE password_reset_tokens
        SET used_at = UTC_TIMESTAMP()
        WHERE user_id = ? AND used_at IS NULL
      `,
      [user.id]
    );

    // Sign out all existing sessions for this account.
    await connection.execute(
      "DELETE FROM sessions WHERE user_id = ?",
      [user.id]
    );

    await connection.commit();

    res.clearCookie("fleet_session", { path: "/" });

    res.json({
      message:
        "Password updated. Sign in with your new password.",
    });

    notify(user, "password", req.ip);
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch {}
    }

    console.error(
      "Password reset failed:",
      error.code || error.name
    );

    res.status(500).json({
      message:
        "Unable to reset your password. Please try again.",
    });
  } finally {
    if (connection) connection.release();
  }
});

module.exports = router;
