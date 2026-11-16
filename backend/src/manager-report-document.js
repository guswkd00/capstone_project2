"use strict";

const DOCUMENT_LIMITS = Object.freeze({
  bytes: 1024 * 1024,
  nodes: 5000,
  depth: 32,
  textChars: 50000
});

const FONT_FAMILIES = Object.freeze([
  "Arial",
  "Arial Black",
  "Calibri",
  "Cambria",
  "Times New Roman",
  "Georgia",
  "Tahoma",
  "Verdana",
  "Courier New",
  "Trebuchet MS",
  "Comic Sans MS",
  "Segoe UI"
]);

const DEFAULT_PAGE_SETTINGS = Object.freeze({
  paper: "A4",
  orientation: "portrait",
  margins: Object.freeze({
    top: 18,
    right: 18,
    bottom: 18,
    left: 18
  }),
  defaultFont: "Arial",
  defaultFontSize: 11,
  lineHeight: 1.5
});

const ALLOWED_TAGS = new Set([
  "p",
  "div",
  "span",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "sub",
  "sup",
  "br",
  "hr",
  "blockquote",
  "pre",
  "code",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "td",
  "th",
  "colgroup",
  "col",
  "img",
  "a"
]);

const BLOCK_TAGS = new Set([
  "p",
  "div",
  "blockquote",
  "pre",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "table",
  "tr"
]);

const VOID_TAGS = new Set([
  "br",
  "hr",
  "img",
  "col"
]);

function fail(message) {
  throw Object.assign(
    new Error(message),
    { status: 400 }
  );
}

function object(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail(`${label} must be an object.`);
  }

  return value;
}

function keys(value, allowed, label) {
  const accepted = new Set(allowed);

  if (
    Object.keys(value).some(
      key => !accepted.has(key)
    )
  ) {
    fail(`${label} contains unsupported fields.`);
  }
}

function numberInRange(
  value,
  minimum,
  maximum,
  label
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    fail(
      `${label} must be between ${minimum} and ${maximum}.`
    );
  }

  return value;
}

function integerInRange(
  value,
  minimum,
  maximum,
  label
) {
  numberInRange(
    value,
    minimum,
    maximum,
    label
  );

  if (!Number.isInteger(value)) {
    fail(`${label} must be an integer.`);
  }

  return value;
}

function attachmentId(value) {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]{0,19}$/.test(value) ||
    BigInt(value) > 18446744073709551615n
  ) {
    fail("Invalid image attachment ID.");
  }

  return value;
}

function safeLink(value) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 2048 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    fail("Invalid document link.");
  }

  let url;

  try {
    url = new URL(value.trim());
  } catch {
    fail("Use an absolute HTTP, HTTPS or email link.");
  }

  if (
    !["http:", "https:", "mailto:"].includes(
      url.protocol
    )
  ) {
    fail("Unsupported document link protocol.");
  }

  if (url.username || url.password) {
    fail("Document links cannot contain credentials.");
  }

  return url.href;
}

function cssLength(
  value,
  maximum,
  allowPercent = false
) {
  if (typeof value !== "string") {
    fail("Invalid document size.");
  }

  const expression = allowPercent
    ? /^(\d+(?:\.\d+)?)(px|pt|%)$/
    : /^(\d+(?:\.\d+)?)(px|pt)$/;

  const match = value.match(expression);

  if (!match) {
    fail("Invalid document size.");
  }

  const amount = Number(match[1]);
  const unit = match[2];

  if (
    amount < 0 ||
    amount > (
      unit === "%"
        ? 100
        : maximum
    )
  ) {
    fail("Document size is out of range.");
  }

  return `${amount}${unit}`;
}

function cleanStyle(input) {
  if (input === undefined) return {};

  object(input, "Document style");

  keys(
    input,
    [
      "fontFamily",
      "fontSize",
      "fontWeight",
      "fontStyle",
      "textDecoration",
      "color",
      "backgroundColor",
      "textAlign",
      "lineHeight",
      "marginLeft",
      "width",
      "height"
    ],
    "Document style"
  );

  const style = {};

  for (
    const [name, value]
    of Object.entries(input)
  ) {
    switch (name) {
      case "fontFamily": {
        if (!FONT_FAMILIES.includes(value)) {
          fail("Unsupported font family.");
        }

        style.fontFamily = value;
        break;
      }

      case "fontSize": {
        const size = cssLength(value, 96);

        if (parseFloat(size) < 6) {
          fail("Font size must be at least 6.");
        }

        style.fontSize = size;
        break;
      }

      case "fontWeight": {
        if (
          ![
            "normal",
            "bold",
            "100",
            "200",
            "300",
            "400",
            "500",
            "600",
            "700",
            "800",
            "900"
          ].includes(value)
        ) {
          fail("Unsupported font weight.");
        }

        style.fontWeight = value;
        break;
      }

      case "fontStyle": {
        if (
          !["normal", "italic"].includes(value)
        ) {
          fail("Unsupported font style.");
        }

        style.fontStyle = value;
        break;
      }

      case "textDecoration": {
        if (
          ![
            "none",
            "underline",
            "line-through",
            "underline line-through"
          ].includes(value)
        ) {
          fail("Unsupported text decoration.");
        }

        style.textDecoration = value;
        break;
      }

      case "color":
      case "backgroundColor": {
        if (
          typeof value !== "string" ||
          !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(
            value
          )
        ) {
          fail("Use a valid hexadecimal color.");
        }

        style[name] = value.toLowerCase();
        break;
      }

      case "textAlign": {
        if (
          ![
            "left",
            "center",
            "right",
            "justify"
          ].includes(value)
        ) {
          fail("Unsupported text alignment.");
        }

        style.textAlign = value;
        break;
      }

      case "lineHeight": {
        style.lineHeight = numberInRange(
          value,
          1,
          3,
          "Line spacing"
        );

        break;
      }

      case "marginLeft": {
        style.marginLeft = cssLength(
          value,
          240
        );

        break;
      }

      case "width":
      case "height": {
        style[name] = cssLength(
          value,
          1600,
          true
        );

        break;
      }
    }
  }

  return style;
}

function cleanAttributes(
  tag,
  input,
  imageIds
) {
  const attrs = input === undefined
    ? {}
    : object(input, "Document attributes");

  const allowed = [];

  if (tag === "a") {
    allowed.push("href");
  }

  if (tag === "img") {
    allowed.push(
      "attachment_id",
      "alt"
    );
  }

  if (tag === "td" || tag === "th") {
    allowed.push(
      "colspan",
      "rowspan"
    );
  }

  if (tag === "ol") {
    allowed.push("start");
  }

  keys(
    attrs,
    allowed,
    "Document attributes"
  );

  const result = {};

  if (tag === "a" && attrs.href !== undefined) {
    result.href = safeLink(
      attrs.href
    );
  }

  if (tag === "img") {
    result.attachment_id = attachmentId(
      attrs.attachment_id
    );

    imageIds.add(
      result.attachment_id
    );

    if (
      attrs.alt !== undefined &&
      (
        typeof attrs.alt !== "string" ||
        attrs.alt.length > 300
      )
    ) {
      fail("Image description is too long.");
    }

    result.alt = attrs.alt || "";
  }

  if (
    tag === "td" ||
    tag === "th"
  ) {
    if (attrs.colspan !== undefined) {
      result.colspan = integerInRange(
        attrs.colspan,
        1,
        20,
        "Column span"
      );
    }

    if (attrs.rowspan !== undefined) {
      result.rowspan = integerInRange(
        attrs.rowspan,
        1,
        100,
        "Row span"
      );
    }
  }

  if (
    tag === "ol" &&
    attrs.start !== undefined
  ) {
    result.start = integerInRange(
      attrs.start,
      1,
      10000,
      "List start"
    );
  }

  return result;
}

function validateDocument(input) {
  if (input === null) {
    return {
      document: null,
      text: null,
      attachment_ids: []
    };
  }

  object(input, "Editor document");

  keys(
    input,
    ["version", "nodes"],
    "Editor document"
  );

  if (
    input.version !== 1 ||
    !Array.isArray(input.nodes)
  ) {
    fail("Unsupported editor document format.");
  }

  let serialized;

  try {
    serialized = JSON.stringify(input);
  } catch {
    fail("Invalid editor document.");
  }

  if (
    Buffer.byteLength(
      serialized,
      "utf8"
    ) > DOCUMENT_LIMITS.bytes
  ) {
    fail("The editor document is too large.");
  }

  let count = 0;
  let textLength = 0;

  const textParts = [];
  const imageIds = new Set();

  function visit(node, depth) {
    count++;

    if (
      count > DOCUMENT_LIMITS.nodes ||
      depth > DOCUMENT_LIMITS.depth
    ) {
      fail("The editor document is too complex.");
    }

    object(node, "Document node");

    if (node.type === "text") {
      keys(
        node,
        ["type", "text"],
        "Text node"
      );

      if (
        typeof node.text !== "string"
      ) {
        fail("Invalid document text.");
      }

      textLength += node.text.length;

      if (
        textLength >
        DOCUMENT_LIMITS.textChars
      ) {
        fail("Report text exceeds 50000 characters.");
      }

      textParts.push(node.text);

      return {
        type: "text",
        text: node.text
      };
    }

    if (node.type === "pageBreak") {
      keys(
        node,
        ["type"],
        "Page break"
      );

      textParts.push("\n\n");

      return {
        type: "pageBreak"
      };
    }

    if (node.type !== "element") {
      fail("Unsupported document node.");
    }

    keys(
      node,
      [
        "type",
        "tag",
        "attrs",
        "style",
        "children"
      ],
      "Element node"
    );

    if (
      typeof node.tag !== "string" ||
      !ALLOWED_TAGS.has(node.tag) ||
      !Array.isArray(node.children)
    ) {
      fail("Unsupported document element.");
    }

    if (
      VOID_TAGS.has(node.tag) &&
      node.children.length
    ) {
      fail("This document element cannot contain children.");
    }

    const attrs = cleanAttributes(
      node.tag,
      node.attrs,
      imageIds
    );

    const style = cleanStyle(
      node.style
    );

    const children = node.children.map(
      child =>
        visit(child, depth + 1)
    );

    if (
      node.tag === "br" ||
      node.tag === "hr" ||
      BLOCK_TAGS.has(node.tag)
    ) {
      textParts.push("\n");
    }

    if (
      node.tag === "td" ||
      node.tag === "th"
    ) {
      textParts.push("\t");
    }

    if (node.tag === "img") {
      textParts.push(
        `[Image: ${
          attrs.alt || "attachment"
        }]`
      );
    }

    const result = {
      type: "element",
      tag: node.tag,
      children
    };

    if (Object.keys(attrs).length) {
      result.attrs = attrs;
    }

    if (Object.keys(style).length) {
      result.style = style;
    }

    return result;
  }

  const nodes = input.nodes.map(
    node => visit(node, 0)
  );

  const text = textParts
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (
    text.length >
    DOCUMENT_LIMITS.textChars
  ) {
    fail("Report text exceeds 50000 characters.");
  }

  return {
    document: {
      version: 1,
      nodes
    },
    text,
    attachment_ids: [
      ...imageIds
    ]
  };
}

function validatePageSettings(input) {
  if (input === null) return null;

  object(input, "Page settings");

  keys(
    input,
    [
      "paper",
      "orientation",
      "margins",
      "defaultFont",
      "defaultFontSize",
      "lineHeight"
    ],
    "Page settings"
  );

  const paper =
    input.paper ??
    DEFAULT_PAGE_SETTINGS.paper;

  const orientation =
    input.orientation ??
    DEFAULT_PAGE_SETTINGS.orientation;

  const defaultFont =
    input.defaultFont ??
    DEFAULT_PAGE_SETTINGS.defaultFont;

  if (!["A4", "Letter"].includes(paper)) {
    fail("Select A4 or Letter paper.");
  }

  if (
    ![
      "portrait",
      "landscape"
    ].includes(orientation)
  ) {
    fail("Invalid page orientation.");
  }

  if (
    !FONT_FAMILIES.includes(defaultFont)
  ) {
    fail("Unsupported default font.");
  }

  const suppliedMargins =
    input.margins === undefined
      ? {}
      : object(
        input.margins,
        "Page margins"
      );

  keys(
    suppliedMargins,
    [
      "top",
      "right",
      "bottom",
      "left"
    ],
    "Page margins"
  );

  const margins = {};

  for (const side of [
    "top",
    "right",
    "bottom",
    "left"
  ]) {
    margins[side] = numberInRange(
      suppliedMargins[side] ??
        DEFAULT_PAGE_SETTINGS.margins[side],
      5,
      40,
      `${side} margin`
    );
  }

  return {
    paper,
    orientation,
    margins,
    defaultFont,

    defaultFontSize: numberInRange(
      input.defaultFontSize ??
        DEFAULT_PAGE_SETTINGS.defaultFontSize,
      6,
      72,
      "Default font size"
    ),

    lineHeight: numberInRange(
      input.lineHeight ??
        DEFAULT_PAGE_SETTINGS.lineHeight,
      1,
      3,
      "Default line spacing"
    )
  };
}

module.exports = {
  DOCUMENT_LIMITS,
  FONT_FAMILIES,
  DEFAULT_PAGE_SETTINGS,
  validateDocument,
  validatePageSettings
};
