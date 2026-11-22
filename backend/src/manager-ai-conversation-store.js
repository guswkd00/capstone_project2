"use strict";

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function validId(id) {
  return typeof id === "string" &&
    /^[1-9][0-9]{0,19}$/.test(id) &&
    BigInt(id) <= 18446744073709551615n;
}

async function loadConversation(db, managerId, conversationId) {
  if (!validId(conversationId)) {
    fail(400, "Invalid conversation ID.");
  }

  const [rows] = await db.execute(
    `SELECT CAST(id AS CHAR) AS id, order_id, title
     FROM manager_ai_conversations
     WHERE id = ? AND manager_id = ?`,
    [conversationId, managerId]
  );

  if (!rows.length) fail(404, "Conversation not found.");

  const [turns] = await db.execute(
    `SELECT CAST(id AS CHAR) AS id, question, answer, source
     FROM manager_ai_history
     WHERE conversation_id = ? AND manager_id = ?
     ORDER BY id DESC LIMIT 3`,
    [conversationId, managerId]
  );

  const lastId = turns[0]?.id || "0";
  const history = [];

  for (const turn of [...turns].reverse()) {
    // DSS fallback is archived, not treated as a Gemini answer.
    if (!["gemini", "nvidia"].includes(turn.source)) continue;

    history.push(
      {
        role: "user",
        text: turn.question.slice(0, 1500)
      },
      {
        role: "assistant",
        text: turn.answer.slice(0, 1500)
      }
    );
  }

  return {
    ...rows[0],
    last_id: String(lastId),
    history
  };
}

async function saveConversationTurn(db, {
  managerId,
  conversationId,
  expectedLastId,
  orderId = null,
  question,
  answer,
  source
}) {
  if (
    !Number.isSafeInteger(managerId) || managerId <= 0 ||
    !validId(conversationId) ||
    !(expectedLastId === "0" || validId(expectedLastId)) ||
    (orderId !== null &&
      (!Number.isSafeInteger(orderId) || orderId <= 0)) ||
    typeof question !== "string" || !question.trim() ||
    question.length > 1500 ||
    typeof answer !== "string" || !answer.trim() ||
    answer.length > 6000 ||
    !["gemini", "nvidia", "dss", "error"].includes(source)
  ) {
    fail(400, "Invalid conversation message.");
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [owners] = await connection.execute(
      `SELECT order_id FROM manager_ai_conversations
       WHERE id = ? AND manager_id = ?
       FOR UPDATE`,
      [conversationId, managerId]
    );

    if (!owners.length) fail(404, "Conversation not found.");

    const savedOrder = owners[0].order_id == null
      ? null : Number(owners[0].order_id);

    if (savedOrder !== orderId) {
      fail(409, "Order context changed. Start a new chat.");
    }

    const [latest] = await connection.execute(
      `SELECT CAST(id AS CHAR) AS id
       FROM manager_ai_history
       WHERE conversation_id = ? AND manager_id = ?
       ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [conversationId, managerId]
    );

    if (String(latest[0]?.id || "0") !== expectedLastId) {
      fail(
        409,
        "This conversation changed. Reload it before continuing."
      );
    }

    await connection.execute(
      `INSERT INTO manager_ai_history
       (manager_id, conversation_id, order_id,
        question, answer, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        managerId, conversationId, orderId,
        question.trim(), answer.trim(), source
      ]
    );

    const title = question.trim()
      .replace(/\s+/g, " ")
      .slice(0, 120);

    await connection.execute(
      `UPDATE manager_ai_conversations
       SET title = CASE WHEN ? = '0' THEN ? ELSE title END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND manager_id = ?`,
      [expectedLastId, title, conversationId, managerId]
    );

    await connection.commit();

    return {
      saved: true,
      conversation_id: conversationId
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // Preserve the original error.
    }
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  loadConversation,
  saveConversationTurn
};
