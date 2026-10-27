"use strict";

const { LIMITS } = require("./manager-ai-policy");
const { askManagerAI } = require("./manager-ai-client");
const { loadManagerAIContext } = require("./manager-ai-context");
const { validateAIAnswer } = require("./manager-ai-validation");
const {
  loadConversation,
  saveConversationTurn
} = require("./manager-ai-conversation-store");

function snapshot(context) {
  const { generated_at, ...facts } = context;
  return JSON.stringify(facts);
}

function resultData(answer, context, source) {
  return {
    ...answer,
    source,
    order: context.order,
    context_generated_at: context.generated_at,
    warnings: context.warnings,
    candidate_list_limited: context.candidate_list_limited,
    total_candidates: context.total_candidates,
    supplied_candidates: context.candidates.length
  };
}

function fallbackData(context) {
  const suggestions = context.assignment_allowed
    ? context.candidates
        .filter(driver => driver.eligible)
        .slice(0, 3)
        .map(driver => ({
          driver_id: driver.driver_id,
          reason: `Standard DSS score: ${driver.score}. Lower is better.`
        }))
    : [];

  return resultData(validateAIAnswer({
    answer:
      "AI is unavailable. These are standard DSS suggestions, not a Gemini answer.",
    suggestions,
    uncertainties: []
  }, context), context, "dss");
}

function createManagerAIHandler({
  db,
  ask = askManagerAI,
  loadContext = loadManagerAIContext,
  validate = validateAIAnswer,
  now = Date.now,
  loadThread = loadConversation,
  saveTurn = saveConversationTurn
}) {
  const recent = [];
  const managers = new Map();
  let busy = false;

  function takeSlot(id) {
    const time = now();

    while (recent.length && recent[0] <= time - 60000) {
      recent.shift();
    }

    for (const [key, times] of managers) {
      const active = times.filter(value => value > time - 60000);
      if (active.length) managers.set(key, active);
      else managers.delete(key);
    }

    const times = managers.get(id) || [];
    if (busy || recent.length >= 4 || times.length >= 3) {
      return false;
    }

    recent.push(time);
    times.push(time);
    managers.set(id, times);
    return true;
  }

  return async function managerAIChat(req, res) {
    res.setHeader("Cache-Control", "no-store");

    if (!req.user) {
      return res.status(401).json({ message: "Sign in first." });
    }

    if (req.user.role !== "manager") {
      return res.status(403).json({
        message: "Manager access is required."
      });
    }

    const {
      question,
      order_id = null,
      history = [],
      conversation_id = null
    } = req.body || {};

    if (
      typeof question !== "string" ||
      !question.trim() ||
      question.length > LIMITS.questionChars ||
      (order_id !== null &&
        (!Number.isSafeInteger(order_id) || order_id <= 0)) ||
      (conversation_id !== null && (
        typeof conversation_id !== "string" ||
        !/^[1-9][0-9]{0,19}$/.test(conversation_id) ||
        BigInt(conversation_id) > 18446744073709551615n
      )) ||
      !Array.isArray(history) ||
      history.length > LIMITS.historyMessages ||
      history.some(item =>
        !item ||
        !["user", "assistant"].includes(item.role) ||
        typeof item.text !== "string" ||
        !item.text.trim() ||
        item.text.length > LIMITS.questionChars
      )
    ) {
      return res.status(400).json({
        message: "Invalid or oversized chat request."
      });
    }

    if (!takeSlot(req.user.id)) {
      res.setHeader("Retry-After", "60");
      return res.status(429).json({
        message:
          "AI is busy or the local request limit was reached. Use the standard DSS or try later."
      });
    }

    busy = true;
    let context = null;
    let thread = null;
    let activeOrderId = order_id;

    async function persist(data) {
      if (!thread) return data;

      try {
        await saveTurn(db, {
          managerId: req.user.id,
          conversationId: thread.id,
          expectedLastId: thread.last_id,
          orderId: activeOrderId,
          question: question.trim(),
          answer: data.answer,
          source: data.source
        });

        return {
          ...data,
          conversation_id: thread.id,
          history_saved: true
        };
      } catch (error) {
        return {
          ...data,
          conversation_id: thread.id,
          history_saved: false,
          history_error: [404, 409].includes(error.status)
            ? "Conversation changed or was deleted. Reload it before continuing."
            : "Reply received, but history could not be saved."
        };
      }
    }

    try {
      let conversationHistory = history;

      if (conversation_id !== null) {
        const loaded = await loadThread(
          db, req.user.id, conversation_id
        );

        activeOrderId = loaded.order_id == null
          ? null : Number(loaded.order_id);

        if (
          Object.hasOwn(req.body, "order_id") &&
          order_id !== activeOrderId
        ) {
          throw Object.assign(new Error(
            "Order context differs from this conversation. Start a new chat."
          ), { status: 409 });
        }

        thread = loaded;
        conversationHistory = thread.history;
      }

      // Operational facts always come from the server.
      context = await loadContext(activeOrderId, db);
      const original = snapshot(context);

      const answer = await ask({
        question: question.trim(),
        context,
        history: conversationHistory
      });

      // Do not return stale recommendations after a failed refresh.
      context = null;
      context = await loadContext(activeOrderId, db);

      if (snapshot(context) !== original) {
        throw Object.assign(new Error(
          "Dispatch data changed. Review the refreshed DSS suggestions and ask again."
        ), { status: 409 });
      }

      const data = resultData(
        validate(answer, context),
        context,
        "gemini"
      );

      return res.json({ data: await persist(data) });
    } catch (error) {
      const status = [
        400, 404, 409, 422, 429, 502, 503, 504
      ].includes(error.status) ? error.status : 500;

      if (status === 429) {
        res.setHeader("Retry-After", "60");
      }

      return res.status(status).json({
        message: status === 500
          ? "Unable to process this chat request."
          : error.message,
        fallback: context
          ? await persist(fallbackData(context))
          : null
      });
    } finally {
      busy = false;
    }
  };
}

module.exports = { createManagerAIHandler };
