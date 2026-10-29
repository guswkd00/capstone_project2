"use strict";

function isManager(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!req.user) {
    res.status(401).json({ message: "Sign in first." });
    return false;
  }

  if (req.user.role !== "manager") {
    res.status(403).json({ message: "Manager access is required." });
    return false;
  }

  return true;
}

async function saveExchange(
  db, managerId, orderId, question, answer, source
) {
  if (
    !Number.isSafeInteger(managerId) || managerId <= 0 ||
    (orderId !== null &&
      (!Number.isSafeInteger(orderId) || orderId <= 0)) ||
    typeof question !== "string" || !question.trim() ||
    question.length > 1500 ||
    typeof answer !== "string" || !answer.trim() ||
    answer.length > 6000 ||
    !["gemini", "dss", "error"].includes(source)
  ) {
    throw new Error("Invalid history record.");
  }

  await db.execute(
    `INSERT INTO manager_ai_history
      (manager_id, order_id, question, answer, source)
     VALUES (?, ?, ?, ?, ?)`,
    [managerId, orderId, question.trim(), answer.trim(), source]
  );
}

function createHistoryHandlers(db) {
  return {
    async list(req, res) {
      if (!isManager(req, res)) return;

      const before = req.query?.before;

      if (
        before !== undefined &&
        (
          typeof before !== "string" ||
          !/^[1-9][0-9]{0,19}$/.test(before) ||
          BigInt(before) > 18446744073709551615n
        )
      ) {
        return res.status(400).json({
          message: "Invalid history cursor."
        });
      }

      try {
        const [rows] = await db.execute(
          `SELECT CAST(id AS CHAR) AS id, order_id,
             question, answer, source,
             DATE_FORMAT(
               created_at, '%Y-%m-%dT%H:%i:%sZ'
             ) AS created_at
           FROM manager_ai_history
           WHERE manager_id = ?
             ${before ? "AND id < ?" : ""}
           ORDER BY id DESC LIMIT 31`,
          before ? [req.user.id, before] : [req.user.id]
        );

        const page = rows.slice(0, 30);

        return res.json({
          data: page.reverse(),
          next_before:
            rows.length > 30 ? String(rows[29].id) : null
        });
      } catch {
        return res.status(503).json({
          message: "Unable to load chat history."
        });
      }
    },

    // Route must use the existing authentication and CSRF middleware.
    async clear(req, res) {
      if (!isManager(req, res)) return;

      try {
        await db.execute(
          "DELETE FROM manager_ai_history WHERE manager_id = ?",
          [req.user.id]
        );

        return res.json({
          message: "Chat history deleted."
        });
      } catch {
        return res.status(503).json({
          message: "Unable to delete chat history."
        });
      }
    }
  };
}

module.exports = { saveExchange, createHistoryHandlers };
