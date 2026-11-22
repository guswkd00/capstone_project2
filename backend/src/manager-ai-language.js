"use strict";

const {
  REFUSAL_MESSAGE,
  MISSING_KNOWLEDGE_MESSAGE
} = require("./manager-ai-knowledge");

const SCOPE_MESSAGES = Object.freeze({
  en: Object.freeze({
    OUT_OF_SCOPE: REFUSAL_MESSAGE,
    INSUFFICIENT_CONTEXT: MISSING_KNOWLEDGE_MESSAGE
  }),

  vi: Object.freeze({
    OUT_OF_SCOPE:
      "Nội dung bạn hỏi nằm ngoài phạm vi hệ thống quản lý giao hàng " +
      "ShopeeFood Delivery DSS. Tôi có thể hỗ trợ chọn tài xế, điều phối đơn, " +
      "tiến trình giao hàng, COD, bảo trì xe, chi phí và báo cáo.",

    INSUFFICIENT_CONTEXT:
      "Hệ thống chưa cung cấp đủ dữ liệu hoặc tài liệu đã xác minh để trả lời " +
      "câu hỏi này. Vui lòng chọn đơn hàng liên quan hoặc kiểm tra báo cáo " +
      "tương ứng. Tôi không thể tự suy đoán số liệu hay xác nhận chính sách " +
      "ShopeeFood khi chưa có nguồn đã xác minh."
  })
});

// The model classifies meaning and language.
// The server controls fixed refusal and missing-data messages.
function enforceLocalizedScope(answer) {
  if (
    !answer ||
    typeof answer !== "object" ||
    Array.isArray(answer) ||
    ![
      "IN_SCOPE",
      "OUT_OF_SCOPE",
      "INSUFFICIENT_CONTEXT"
    ].includes(answer.scope) ||
    !["en", "vi"].includes(answer.language)
  ) {
    throw Object.assign(
      new Error(
        "AI returned an invalid scope or language. Use the standard DSS."
      ),
      { status: 502 }
    );
  }

  if (answer.scope === "IN_SCOPE") {
    return answer;
  }

  return {
    scope: answer.scope,
    language: answer.language,
    answer: SCOPE_MESSAGES[answer.language][answer.scope],
    suggestions: [],
    uncertainties: []
  };
}

module.exports = {
  SCOPE_MESSAGES,
  enforceLocalizedScope
};
