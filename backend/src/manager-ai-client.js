"use strict";

const {
  LIMITS, SYSTEM_INSTRUCTION, RESPONSE_SCHEMA
} = require("./manager-ai-policy");

function aiError(status, message) {
  return Object.assign(new Error(message), { status });
}

// Server only. Caller must validate suggested driver IDs.
async function askManagerAI(
  { question, context, history = [] } = {},
  fetchImpl = fetch
) {
  const key = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim();

  if (!key || !model || !/^gemini-[a-z0-9._-]{1,100}$/.test(model)) {
    throw aiError(
      503,
      "AI is not configured. Use the standard DSS recommendations."
    );
  }

  if (
    typeof question !== "string" || !question.trim() ||
    question.length > LIMITS.questionChars ||
    !context || typeof context !== "object" || Array.isArray(context) ||
    !Array.isArray(history) || history.length > LIMITS.historyMessages ||
    history.some(item =>
      !item || !["user", "assistant"].includes(item.role) ||
      typeof item.text !== "string" || !item.text.trim() ||
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

  const contents = history.map(item => ({
    role: item.role === "assistant" ? "model" : "user",
    parts: [{ text: item.text }]
  }));

  contents.push({
    role: "user",
    parts: [{ text: currentMessage }]
  });

  try {
    const response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key
        },
        signal: AbortSignal.timeout(LIMITS.timeoutMs),
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_INSTRUCTION }]
          },
          contents,
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: LIMITS.outputTokens,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA
          }
        })
      }
    );

    if (response.status === 429) {
      throw aiError(
        429,
        "AI quota is exhausted. Use the standard DSS or try later."
      );
    }

    if (!response.ok) {
  throw aiError(
    503,
    `Gemini API returned HTTP ${response.status}. Use the standard DSS.`
  );
}

    const raw = await response.text();

    if (raw.length > 60000) {
      throw aiError(502, "AI response is too large.");
    }

    const result = JSON.parse(raw);

    if (result.promptFeedback?.blockReason) {
      throw aiError(
        422,
        "AI could not answer this request. Rephrase your question."
      );
    }

    const candidate = result.candidates?.[0];

    if (!candidate || candidate.finishReason !== "STOP") {
      throw aiError(
        502,
        "AI did not complete a usable answer. Use the standard DSS."
      );
    }

    const text = (candidate.content?.parts || [])
      .filter(part => !part.thought && typeof part.text === "string")
      .map(part => part.text)
      .join("");

    if (!text || text.length > 20000) {
      throw aiError(502, "AI returned an invalid answer.");
    }

    const answer = JSON.parse(text);

    if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
      throw aiError(502, "AI returned an invalid answer.");
    }

    return answer;
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw aiError(
        504,
        "AI timed out. Use the standard DSS or try later."
      );
    }

    if ([400, 422, 429, 502, 503, 504].includes(error.status)) {
      throw error;
    }

    throw aiError(
      503,
      "AI could not return a usable answer. Use the standard DSS."
    );
  }
}

module.exports = { askManagerAI };
