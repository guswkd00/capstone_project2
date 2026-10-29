"use strict";

function invalidAnswer() {
  return Object.assign(
    new Error(
      "AI returned an invalid recommendation. Use the standard DSS."
    ),
    { status: 502 }
  );
}

function boundedText(value, maxLength) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength
  ) {
    throw invalidAnswer();
  }

  return value.trim();
}

function validateAIAnswer(answer, context) {
  if (
    !answer ||
    typeof answer !== "object" ||
    Array.isArray(answer) ||
    !context ||
    !Array.isArray(context.candidates) ||
    !Array.isArray(answer.suggestions) ||
    answer.suggestions.length > 3 ||
    !Array.isArray(answer.uncertainties) ||
    answer.uncertainties.length > 6
  ) {
    throw invalidAnswer();
  }

  const text = boundedText(answer.answer, 6000);

  const uncertainties = answer.uncertainties.map(item =>
    boundedText(item, 500)
  );

  const assignmentAllowed =
    context.assignment_allowed === true &&
    ["pending", "confirmed", "assigned"].includes(
      context.order?.status
    );

  if (!assignmentAllowed && answer.suggestions.length) {
    throw invalidAnswer();
  }

  const candidates = new Map(
    context.candidates.map(driver => [
      driver.driver_id,
      driver
    ])
  );

  const seen = new Set();

  const suggestions = answer.suggestions.map(item => {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      !Number.isSafeInteger(item.driver_id) ||
      item.driver_id <= 0 ||
      seen.has(item.driver_id)
    ) {
      throw invalidAnswer();
    }

    const driver = candidates.get(item.driver_id);

    if (!driver || driver.eligible !== true) {
      throw invalidAnswer();
    }

    seen.add(item.driver_id);

    return {
      driver_id: driver.driver_id,
      driver_code: driver.driver_code,
      reason: boundedText(item.reason, 600),
      pickup_km: driver.pickup_km,
      eta_minutes: driver.eta_minutes,
      active_orders: driver.active_orders,
      score: driver.score,
      is_dss_recommended:
        driver.driver_id === context.recommended_driver_id,
      currently_assigned:
        driver.driver_id === context.order.assigned_driver_id
    };
  });

  return {
    language: answer.language === "vi" ? "vi" : "en",
    answer: text,
    suggestions,
    uncertainties,
    requires_manager_approval: true
  };
}

module.exports = { validateAIAnswer };
