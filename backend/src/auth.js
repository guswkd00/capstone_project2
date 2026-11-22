const express = require("express");
const { pool } = require("./db");

const {
  verifyPassword,
  createToken,
  hashToken,
} = require("./security");

const { notify } = require("./mail");
const passwordResetRouter = require("./password-reset");

const router = express.Router();
router.use(passwordResetRouter);
const loginAttempts = new Map();

function sessionToken(req) {
  const cookies = (req.headers.cookie || "")
    .split(";")
    .map(value => value.trim());

  const session = cookies.find(value =>
    value.startsWith("fleet_session=")
  );

  if (!session) return null;

  const token = session.slice("fleet_session=".length);

  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function rejectUnauthenticated(req, res, message) {
  const pagePath = (req.originalUrl || "").split("?")[0];

  if (
    ["GET", "HEAD"].includes(req.method) &&
    /^\/driver\.html\/?$/.test(pagePath)
  ) {
    return res.redirect("/login.html");
  }

  return res.status(401).json({ message });
}

async function requireLogin(req, res, next) {
  const token = sessionToken(req);

    if (!token) {
    return rejectUnauthenticated(
      req,
      res,
      "Please sign in."
    );
  }

  try {
    const [users] = await pool.execute(
      `
        SELECT
          u.id,
          u.email,
          u.full_name,
          u.role,
          s.csrf_token,
          s.token_hash
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
          AND s.expires_at > UTC_TIMESTAMP()
          AND u.active = 1
      `,
      [hashToken(token)]
    );

     if (!users.length) {
      return rejectUnauthenticated(
        req,
        res,
        "Your session has expired. Please sign in again."
      );
    }

    req.user = users[0];
    next();
  } catch (error) {
    console.error("Session lookup failed:", error.code);

    res.status(500).json({
      message: "Unable to verify your session.",
    });
  }
}

function requireManager(req, res, next) {
  if (req.user?.role !== "manager") {
    return res.status(403).json({
      message: "Manager access is required.",
    });
  }

  next();
}

function requireCsrf(req, res, next) {
  if (
    !req.user ||
    req.headers["x-csrf-token"] !== req.user.csrf_token
  ) {
    return res.status(403).json({
      message: "Invalid security token. Refresh the page and try again.",
    });
  }

  next();
}

router.post("/login", async (req, res) => {
  const email = typeof req.body?.email === "string"
    ? req.body.email.trim().toLowerCase()
    : "";

  const password = req.body?.password;
  const expectedRole = req.body?.expectedRole;

  if (expectedRole != null && !["manager", "driver"].includes(expectedRole)) {
    return res.status(400).json({ message: "Invalid account role." });
  }

  if (
    !email ||
    email.length > 150 ||
    typeof password !== "string" ||
    !password ||
    password.length > 200
  ) {
    return res.status(400).json({
      message: "Enter a valid email and password.",
    });
  }

  const now = Date.now();

  for (const [key, attempt] of loginAttempts) {
    if (attempt.expiresAt <= now) loginAttempts.delete(key);
  }

  const key = req.ip;
  const attempt = loginAttempts.get(key) || {
    count: 0,
    expiresAt: now + 15 * 60 * 1000,
  };

  if (attempt.count >= 15) {
    return res.status(429).json({
      message: "Too many failed attempts. Try again in 15 minutes.",
    });
  }

  try {
    const [users] = await pool.execute(
      `
        SELECT id, email, full_name, role, password_hash
        FROM users
        WHERE email = ? AND active = 1
      `,
      [email]
    );

    const user = users[0];

    if (
      !user ||
      !await verifyPassword(password, user.password_hash)
    ) {
      attempt.count++;
      loginAttempts.set(key, attempt);

      return res.status(401).json({
        message: "Incorrect email or password.",
      });
    }

    if (expectedRole && expectedRole !== user.role) {
      return res.status(403).json({ message: "This account belongs to a different role. Select the correct login tab." });
    }
    loginAttempts.delete(key);

    const token = createToken();
    const csrfToken = createToken();

    await pool.execute(
      "DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()"
    );

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [currentUsers] = await connection.execute(
        "SELECT id, email, full_name, role, password_hash FROM users WHERE id = ? AND active = 1 FOR UPDATE",
        [user.id]
      );
      const current = currentUsers[0];
      if (!current || current.password_hash !== user.password_hash || current.email.toLowerCase() !== email) {
        await connection.rollback();
        return res.status(401).json({ message: "Your account changed. Sign in again." });
      }
      if (expectedRole && expectedRole !== current.role) {
        await connection.rollback();
        return res.status(403).json({ message: "This account belongs to a different role. Select the correct login tab." });
      }
      user.full_name = current.full_name;
      user.role = current.role;
      user.email = current.email;
      await connection.execute(
        `INSERT INTO sessions (token_hash, user_id, csrf_token, expires_at)
         VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 8 HOUR))`,
        [hashToken(token), user.id, csrfToken]
      );
      await connection.commit();
    } catch (error) {
      try { await connection.rollback(); } catch {}
      throw error;
    } finally {
      connection.release();
    }

    res.cookie("fleet_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "1",
      maxAge: 8 * 60 * 60 * 1000,
      path: "/",
    });

    res.set("Cache-Control", "no-store");

    res.json({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        role: user.role,
      },
      csrf_token: csrfToken,
    });

    notify(user, "login", req.ip);
  } catch (error) {
    console.error("Login failed:", error.code || error.name);

    res.status(500).json({
      message: "Unable to sign in.",
    });
  }
});

router.get("/me", requireLogin, (req, res) => {
  res.set("Cache-Control", "no-store");

  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      full_name: req.user.full_name,
      role: req.user.role,
    },
    csrf_token: req.user.csrf_token,
  });
});

router.post(
  "/logout",
  requireLogin,
  requireCsrf,
  async (req, res) => {
    try {
      await pool.execute(
        "DELETE FROM sessions WHERE token_hash = ?",
        [req.user.token_hash]
      );

      res.clearCookie("fleet_session", { path: "/" });
      res.json({ message: "Signed out successfully." });
    } catch (error) {
      console.error("Logout failed:", error.code);

      res.status(500).json({
        message: "Unable to sign out.",
      });
    }
  }
);

module.exports = {
  router,
  requireLogin,
  requireManager,
  requireCsrf,
};
