"use strict";

const {
  LIMITS,
  SYSTEM_INSTRUCTION,
  RESPONSE_SCHEMA
} = require("./manager-ai-policy");

const {
  REFUSAL_MESSAGE,
  MISSING_KNOWLEDGE_MESSAGE
} = require("./manager-ai-knowledge");

function aiError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Describe the schema in the prompt.
// Native structured-output support is not assumed.
const outputSchema = JSON.stringify(
  RESPONSE_SCHEMA,
  (key, value) =>
    key === "type" && typeof value === "string"
      ? value.toLowerCase()
      : value
);

async function askNvidiaAI(
  { question, context, history = [] } = {},
  fetchImpl = fetch
) {
  const key = process.env.NVIDIA_API_KEY?.trim();
  const model = process.env.NVIDIA_MODEL?.trim();

  if (
    !key || !model ||
    model.length > 150 ||
    !/^[a-z0-9._-]+\/[a-z0-9._-]+$/i.test(model)
  ) {
    throw aiError(
      503,
      "NVIDIA AI is not configured. Use the standard DSS."
    );
  }

  if (
    typeof question !== "string" ||
    !question.trim() ||
    question.length > LIMITS.questionChars ||
    !context ||
    typeof context !== "object" ||
    Array.isArray(context) ||
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
    throw aiError(400, "Invalid or oversized chat input.");
  }

  let currentMessage;

  try {
    currentMessage = JSON.stringify({
      question: question.trim(),
      context
    });
  } catch {
    throw aiError(400, "Invalid dispatch context.");
  }

  if (currentMessage.length > 24000) {
    throw aiError(400, "Dispatch context is too large.");
  }

  try {
    const response = await fetchImpl(
      "https://integrate.api.nvidia.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`
        },
        signal: AbortSignal.timeout(LIMITS.timeoutMs),
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "system",
              content:
                `${SYSTEM_INSTRUCTION}\n` +
                "Return one JSON object without Markdown. " +
                `Follow this schema:\n${outputSchema}`
            },
            ...history.map(item => ({
              role: item.role,
              content: item.text
            })),
            {
              role: "user",
              content: currentMessage
            }
          ],
          temperature: 0.2,
          top_p: 1,
          max_tokens: LIMITS.outputTokens,
          stream: false
        })
      }
    );

    if (response.status === 429) {
      throw aiError(
        429,
        "NVIDIA quota or rate limit reached. Use the standard DSS or try later."
      );
    }

    if (!response.ok) {
      throw aiError(
        503,
        `NVIDIA API returned HTTP ${response.status}. Use the standard DSS.`
      );
    }

    const raw = await response.text();

    if (raw.length > 60000) {
      throw aiError(502, "AI response is too large.");
    }

    const result = JSON.parse(raw);
    const choice = result.choices?.[0];

    if (!choice || choice.finish_reason !== "stop") {
      throw aiError(
        502,
        "NVIDIA did not complete a usable answer. Use the standard DSS."
      );
    }

    // Separate reasoning fields and tool calls are not returned.
    const text = choice.message?.content;

    if (
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 20000
    ) {
      throw aiError(502, "NVIDIA returned an invalid answer.");
    }

    const answer = JSON.parse(text);

    if (
      !answer ||
      typeof answer !== "object" ||
      Array.isArray(answer) ||
      ![
        "IN_SCOPE",
        "OUT_OF_SCOPE",
        "INSUFFICIENT_CONTEXT"
      ].includes(answer.scope)
    ) {
      throw aiError(
        502,
        "AI returned an invalid scope classification. Use the standard DSS."
      );
    }

    if (answer.scope !== "IN_SCOPE") {
      return {
        scope: answer.scope,
        answer: answer.scope === "OUT_OF_SCOPE"
          ? REFUSAL_MESSAGE
          : MISSING_KNOWLEDGE_MESSAGE,
        suggestions: [],
        uncertainties: []
      };
    }

    // Existing DSS validation still checks driver IDs and eligibility.
    return answer;
  } catch (error) {
    if (["TimeoutError", "AbortError"].includes(error.name)) {
      throw aiError(
        504,
        "NVIDIA AI timed out. Use the standard DSS or try later."
      );
    }

    if (
      [400, 422, 429, 502, 503, 504].includes(error.status)
    ) {
      throw error;
    }

    throw aiError(
      503,
      "NVIDIA AI could not return a usable answer. Use the standard DSS."
    );
  }
}

module.exports = { askNvidiaAI };
