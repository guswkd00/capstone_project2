"use strict";

const MAX_ID = 18446744073709551615n;

const LIMITS = Object.freeze({
  titleChars: 160,
  contentChars: 50000,
  filesPerReport: 3,
  fileBytes: 5 * 1024 * 1024,
  listSize: 20
});

const REPORT_TYPES = Object.freeze([
  "delivery",
  "cod",
  "maintenance",
  "expense",
  "incident",
  "general"
]);

const REPORT_STATES = Object.freeze([
  "draft",
  "submitted"
]);

function httpError(status, message) {
  return Object.assign(
    new Error(message),
    { status }
  );
}

function parseId(value) {
  if (
    typeof value === "number" &&
    !Number.isSafeInteger(value)
  ) {
    throw httpError(400, "Invalid report ID.");
  }

  if (
    typeof value !== "string" &&
    typeof value !== "number"
  ) {
    throw httpError(400, "Invalid report ID.");
  }

  const text = String(value);

  if (
    !/^[1-9][0-9]{0,19}$/.test(text) ||
    BigInt(text) > MAX_ID
  ) {
    throw httpError(400, "Invalid report ID.");
  }

  return text;
}

function parseVersion(value) {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 4294967295
  ) {
    throw httpError(
      400,
      "Invalid report version. Reload the report and try again."
    );
  }

  return value;
}

function reportDate(value, label) {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number(value.slice(0, 4)) < 1000
  ) {
    throw httpError(
      400,
      `${label} must be a valid date in YYYY-MM-DD format.`
    );
  }

  const date = new Date(
    `${value}T00:00:00.000Z`
  );

  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  ) {
    throw httpError(
      400,
      `${label} is not a valid calendar date.`
    );
  }

  return value;
}

function validateReportInput(
  body,
  { requireVersion = false } = {}
) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body)
  ) {
    throw httpError(
      400,
      "A valid report is required."
    );
  }

  const allowedFields = new Set([
    "title",
    "report_type",
    "period_start",
    "period_end",
    "content",
    "version"
  ]);

  if (
    Object.keys(body).some(
      key => !allowedFields.has(key)
    )
  ) {
    throw httpError(
      400,
      "The report contains unsupported fields."
    );
  }

  if (
    typeof body.title !== "string" ||
    !body.title.trim() ||
    body.title.length > LIMITS.titleChars
  ) {
    throw httpError(
      400,
      `Title must contain 1–${LIMITS.titleChars} characters.`
    );
  }

  if (
    typeof body.report_type !== "string" ||
    !REPORT_TYPES.includes(body.report_type)
  ) {
    throw httpError(
      400,
      "Select a valid report type."
    );
  }

  const content = body.content === undefined
    ? ""
    : body.content;

  if (
    typeof content !== "string" ||
    content.length > LIMITS.contentChars
  ) {
    throw httpError(
      400,
      `Report content must not exceed ${LIMITS.contentChars} characters.`
    );
  }

  const periodStart = reportDate(
    body.period_start,
    "Start date"
  );

  const periodEnd = reportDate(
    body.period_end,
    "End date"
  );

  if (periodEnd < periodStart) {
    throw httpError(
      400,
      "End date must be on or after start date."
    );
  }

  const result = {
    title: body.title.trim(),
    report_type: body.report_type,
    period_start: periodStart,
    period_end: periodEnd,
    content
  };

  if (
    requireVersion ||
    body.version !== undefined
  ) {
    result.version = parseVersion(
      body.version
    );
  }

  return result;
}

function periodBounds(start, end) {
  const periodStart = reportDate(
    start,
    "Start date"
  );

  const periodEnd = reportDate(
    end,
    "End date"
  );

  if (periodEnd < periodStart) {
    throw httpError(
      400,
      "End date must be on or after start date."
    );
  }

  // Report dates use Vietnam time.
  // SQL queries use an inclusive start and exclusive end in UTC.
  const startTime = new Date(
    `${periodStart}T00:00:00+07:00`
  );

  const endTime = new Date(
    new Date(
      `${periodEnd}T00:00:00+07:00`
    ).getTime() + 24 * 60 * 60 * 1000
  );

  const sqlTime = date =>
    date.toISOString()
      .slice(0, 19)
      .replace("T", " ");

  return {
    startUtc: sqlTime(startTime),
    endUtc: sqlTime(endTime)
  };
}

function attachmentName(value) {
  if (
    typeof value !== "string" ||
    value.length > 255 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw httpError(
      400,
      "Invalid attachment filename."
    );
  }

  const name = value
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .trim();

  if (
    !name ||
    name === "." ||
    name === ".."
  ) {
    throw httpError(
      400,
      "Invalid attachment filename."
    );
  }

  return name;
}

function validateAttachment(
  data,
  contentType,
  filename
) {
  if (
    !Buffer.isBuffer(data) ||
    data.length === 0 ||
    data.length > LIMITS.fileBytes
  ) {
    throw httpError(
      400,
      "Choose a non-empty file up to 5 MB."
    );
  }

  const type = String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  const name = attachmentName(filename);

  const isPdf =
    data.length >= 12 &&
    data.subarray(0, 5).toString("ascii") ===
      "%PDF-" &&
    data.subarray(
      Math.max(0, data.length - 1024)
    ).includes(Buffer.from("%%EOF"));

  const isPng =
    data.length >= 33 &&
    data.subarray(0, 8).equals(
      Buffer.from([
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a
      ])
    ) &&
    data.subarray(-8, -4).toString("ascii") ===
      "IEND";

  const isJpeg =
    data.length >= 6 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff &&
    data[data.length - 2] === 0xff &&
    data[data.length - 1] === 0xd9;

  const supported =
    (type === "application/pdf" && isPdf) ||
    (type === "image/png" && isPng) ||
    (type === "image/jpeg" && isJpeg);

  if (!supported) {
    throw httpError(
      415,
      "Upload a PDF, PNG or JPEG file with matching file content."
    );
  }

  return {
    original_name: name,
    content_type: type,
    byte_size: data.length
  };
}

module.exports = {
  LIMITS,
  REPORT_TYPES,
  REPORT_STATES,
  httpError,
  parseId,
  parseVersion,
  validateReportInput,
  validateAttachment,
  periodBounds
};
