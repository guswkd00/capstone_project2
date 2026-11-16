(() => {
  "use strict";

  if (window.ManagerReportRichText) return;

  const FONTS = [
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
  ];

  const TAGS = new Set([
    "p", "div", "span", "strong", "b", "em", "i",
    "u", "s", "strike", "sub", "sup", "br", "hr",
    "blockquote", "pre", "code",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li",
    "table", "thead", "tbody", "tfoot",
    "tr", "td", "th", "colgroup", "col",
    "img", "a"
  ]);

  const BLOCKS = new Set([
    "p", "div", "blockquote", "pre",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "table", "tr"
  ]);

  const VOID = new Set([
    "br", "hr", "img", "col"
  ]);

  const DROP = new Set([
    "script", "style", "iframe", "object",
    "embed", "template", "svg", "math",
    "form", "input", "button", "video",
    "audio", "canvas"
  ]);

  const DEFAULTS = {
    paper: "A4",
    orientation: "portrait",
    margins: {
      top: 18,
      right: 18,
      bottom: 18,
      left: 18
    },
    defaultFont: "Arial",
    defaultFontSize: 11,
    lineHeight: 1.5
  };

  let assetsPromise = null;

  function validId(value) {
    return (
      typeof value === "string" &&
      /^[1-9][0-9]{0,19}$/.test(value) &&
      BigInt(value) <= 18446744073709551615n
    );
  }

  function loadAsset(tag, url) {
    return new Promise((resolve, reject) => {
      const element = document.createElement(tag);

      if (tag === "link") {
        element.rel = "stylesheet";
        element.href = url;
      } else {
        element.src = url;
      }

      element.onload = () => resolve(element);

      element.onerror = () => reject(
        new Error(
          "The rich text editor could not load. Check your connection and refresh."
        )
      );

      document.head.appendChild(element);
    });
  }

  async function loadAssets() {
    if (!assetsPromise) {
      assetsPromise = Promise.all([
        loadAsset(
          "link",
          "https://cdn.jsdelivr.net/npm/jodit@4/es2021/jodit.min.css"
        ),
        window.Jodit
          ? Promise.resolve()
          : loadAsset(
            "script",
            "https://cdn.jsdelivr.net/npm/jodit@4/es2021/jodit.min.js"
          )
      ]).catch(error => {
        assetsPromise = null;
        throw error;
      });
    }

    await assetsPromise;

    if (!window.Jodit) {
      throw new Error(
        "The rich text editor is unavailable."
      );
    }
  }

  function color(value) {
    if (typeof value !== "string") return null;

    const text = value.trim();

    if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(text)) {
      return text.toLowerCase();
    }

    const match = text.match(
      /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i
    );

    if (!match) return null;

    const values = match.slice(1).map(Number);

    if (values.some(value => value > 255)) {
      return null;
    }

    return "#" + values.map(
      value => value.toString(16).padStart(2, "0")
    ).join("");
  }

  function length(value, maximum, percent = false) {
    if (typeof value !== "string") return null;

    const match = value.trim().match(
      /^(\d+(?:\.\d+)?)(px|pt|%)$/
    );

    if (!match) return null;

    const amount = Number(match[1]);
    const unit = match[2];

    if (
      (unit === "%" && !percent) ||
      amount > (unit === "%" ? 100 : maximum)
    ) {
      return null;
    }

    return `${amount}${unit}`;
  }

  function safeLink(value) {
    if (
      typeof value !== "string" ||
      value.length > 2048 ||
      /[\u0000-\u001f\u007f]/.test(value)
    ) {
      return null;
    }

    try {
      const url = new URL(value, location.origin);

      return (
        ["http:", "https:", "mailto:"].includes(
          url.protocol
        ) &&
        !url.username &&
        !url.password
      )
        ? url.href
        : null;
    } catch {
      return null;
    }
  }

  function safeStyle(input = {}) {
    const result = {};

    const family = String(
      input.fontFamily || ""
    )
      .split(",")[0]
      .trim()
      .replace(/^["']|["']$/g, "");

    const font = FONTS.find(
      item =>
        item.toLowerCase() === family.toLowerCase()
    );

    if (font) result.fontFamily = font;

    const fontSize = length(
      input.fontSize,
      96
    );

    if (
      fontSize &&
      parseFloat(fontSize) >= 6
    ) {
      result.fontSize = fontSize;
    }

    const weight = String(
      input.fontWeight || ""
    );

    if (
      [
        "normal", "bold",
        "100", "200", "300", "400", "500",
        "600", "700", "800", "900"
      ].includes(weight)
    ) {
      result.fontWeight = weight;
    }

    if (
      ["normal", "italic"].includes(
        input.fontStyle
      )
    ) {
      result.fontStyle = input.fontStyle;
    }

    if (
      [
        "none",
        "underline",
        "line-through",
        "underline line-through"
      ].includes(input.textDecoration)
    ) {
      result.textDecoration =
        input.textDecoration;
    }

    for (const key of [
      "color",
      "backgroundColor"
    ]) {
      const value = color(input[key]);

      if (value) result[key] = value;
    }

    if (
      ["left", "center", "right", "justify"].includes(
        input.textAlign
      )
    ) {
      result.textAlign = input.textAlign;
    }

    const spacing = Number(input.lineHeight);

    if (
      Number.isFinite(spacing) &&
      spacing >= 1 &&
      spacing <= 3
    ) {
      result.lineHeight = spacing;
    }

    const indent = length(
      input.marginLeft,
      240
    );

    if (indent) result.marginLeft = indent;

    for (const key of ["width", "height"]) {
      const value = length(
        input[key],
        1600,
        true
      );

      if (value) result[key] = value;
    }

    return result;
  }

  function documentFromDOM(root) {
    let count = 0;

    function read(node, depth) {
      count++;

      if (count > 5000 || depth > 32) {
        throw new Error(
          "The document is too complex."
        );
      }

      if (node.nodeType === Node.TEXT_NODE) {
        return [{
          type: "text",
          text: node.nodeValue || ""
        }];
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return [];
      }

      const tag = node.tagName.toLowerCase();

      if (
        DROP.has(tag) ||
        node.hasAttribute("data-jodit-marker") ||
        node.hasAttribute("data-jodit-selection_marker")
      ) {
        return [];
      }

      if (
        node.getAttribute(
          "data-report-page-break"
        ) === "true"
      ) {
        return [{ type: "pageBreak" }];
      }

      const children = [
        ...node.childNodes
      ].flatMap(
        child => read(child, depth + 1)
      );

      const normalizedTag =
        tag === "font" ? "span" : tag;

      if (!TAGS.has(normalizedTag)) {
        return children;
      }

      const attrs = {};
      const style = safeStyle(node.style);

      if (tag === "font") {
        const face = node.getAttribute("face");

        if (FONTS.includes(face)) {
          style.fontFamily = face;
        }

        const fontColor = color(
          node.getAttribute("color")
        );

        if (fontColor) {
          style.color = fontColor;
        }

        const sizes = {
          "1": "8pt",
          "2": "10pt",
          "3": "12pt",
          "4": "14pt",
          "5": "18pt",
          "6": "24pt",
          "7": "36pt"
        };

        const size = sizes[
          node.getAttribute("size")
        ];

        if (size) style.fontSize = size;
      }

      if (normalizedTag === "a") {
        const href = safeLink(
          node.getAttribute("href") || ""
        );

        if (href) attrs.href = href;
      }

      if (normalizedTag === "img") {
        const id = node.getAttribute(
          "data-report-attachment-id"
        );

        if (!validId(id)) {
          const alt = node.getAttribute("alt");

          return alt
            ? [{
              type: "text",
              text: alt
            }]
            : [];
        }

        attrs.attachment_id = id;
        attrs.alt = (
          node.getAttribute("alt") || ""
        ).slice(0, 300);
      }

      if (
        normalizedTag === "td" ||
        normalizedTag === "th"
      ) {
        for (const [key, maximum] of [
          ["colspan", 20],
          ["rowspan", 100]
        ]) {
          const raw = node.getAttribute(key);

          if (raw && /^\d+$/.test(raw)) {
            const value = Number(raw);

            if (
              value >= 1 &&
              value <= maximum
            ) {
              attrs[key] = value;
            }
          }
        }
      }

      if (normalizedTag === "ol") {
        const start = Number(
          node.getAttribute("start")
        );

        if (
          Number.isInteger(start) &&
          start >= 1 &&
          start <= 10000
        ) {
          attrs.start = start;
        }
      }

      const result = {
        type: "element",
        tag: normalizedTag,
        children: VOID.has(normalizedTag)
          ? []
          : children
      };

      if (Object.keys(attrs).length) {
        result.attrs = attrs;
      }

      if (Object.keys(style).length) {
        result.style = style;
      }

      return [result];
    }

    return {
      version: 1,
      nodes: [
        ...root.childNodes
      ].flatMap(node => read(node, 0))
    };
  }

  function plainText(documentValue) {
    const parts = [];

    function visit(node) {
      if (node.type === "text") {
        parts.push(node.text || "");
        return;
      }

      if (node.type === "pageBreak") {
        parts.push("\n\n");
        return;
      }

      for (const child of node.children || []) {
        visit(child);
      }

      if (
        node.tag === "br" ||
        node.tag === "hr" ||
        BLOCKS.has(node.tag)
      ) {
        parts.push("\n");
      }

      if (
        node.tag === "td" ||
        node.tag === "th"
      ) {
        parts.push("\t");
      }

      if (node.tag === "img") {
        parts.push(
          `[Image: ${
            node.attrs?.alt || "attachment"
          }]`
        );
      }
    }

    for (const node of documentValue.nodes || []) {
      visit(node);
    }

    const text = parts.join("")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (text.length > 50000) {
      throw new Error(
        "Report text exceeds 50000 characters."
      );
    }

    return text;
  }

  function plainDocument(text) {
    return {
      version: 1,
      nodes: String(text || "")
        .split("\n")
        .map(line => ({
          type: "element",
          tag: "p",
          children: line
            ? [{
              type: "text",
              text: line
            }]
            : [{
              type: "element",
              tag: "br",
              children: []
            }]
        }))
    };
  }

  function createDOM(documentValue) {
    const container = document.createElement("div");
    let count = 0;

    function build(node, depth) {
      count++;

      if (count > 5000 || depth > 32) {
        throw new Error(
          "The document is too complex."
        );
      }

      if (node.type === "text") {
        return document.createTextNode(
          String(node.text || "")
        );
      }

      if (node.type === "pageBreak") {
        const divider = document.createElement("div");

        divider.className = "mr-page-break";

        divider.setAttribute(
          "data-report-page-break",
          "true"
        );

        divider.setAttribute(
          "contenteditable",
          "false"
        );

        divider.appendChild(
          document.createTextNode("Page break")
        );

        return divider;
      }

      if (
        node.type !== "element" ||
        !TAGS.has(node.tag)
      ) {
        throw new Error(
          "Unsupported document element."
        );
      }

      const element = document.createElement(
        node.tag
      );

      const attrs = node.attrs || {};

      for (const [key, value] of Object.entries(
        safeStyle(node.style)
      )) {
        element.style[key] = String(value);
      }

      if (node.tag === "a" && attrs.href) {
        const href = safeLink(attrs.href);

        if (href) {
          element.href = href;
          element.target = "_blank";
          element.rel = "noopener noreferrer";
        }
      }

      if (node.tag === "img") {
        if (!validId(attrs.attachment_id)) {
          throw new Error(
            "Invalid image attachment."
          );
        }

        element.setAttribute(
          "data-report-attachment-id",
          attrs.attachment_id
        );

        element.alt = String(
          attrs.alt || ""
        ).slice(0, 300);
      }

      if (
        node.tag === "td" ||
        node.tag === "th"
      ) {
        for (const [key, maximum] of [
          ["colspan", 20],
          ["rowspan", 100]
        ]) {
          const value = attrs[key];

          if (
            Number.isInteger(value) &&
            value >= 1 &&
            value <= maximum
          ) {
            element.setAttribute(
              key,
              String(value)
            );
          }
        }
      }

      if (
        node.tag === "ol" &&
        Number.isInteger(attrs.start) &&
        attrs.start >= 1 &&
        attrs.start <= 10000
      ) {
        element.start = attrs.start;
      }

      if (!VOID.has(node.tag)) {
        for (const child of node.children || []) {
          element.appendChild(
            build(child, depth + 1)
          );
        }
      }

      return element;
    }

    if (
      !documentValue ||
      documentValue.version !== 1 ||
      !Array.isArray(documentValue.nodes)
    ) {
      throw new Error(
        "Invalid editor document."
      );
    }

    for (const node of documentValue.nodes) {
      container.appendChild(build(node, 0));
    }

    return container;
  }

  function normalizeSettings(value) {
    const input = value || {};

    function bounded(number, fallback, min, max) {
      const result = Number(number);

      return (
        Number.isFinite(result) &&
        result >= min &&
        result <= max
      )
        ? result
        : fallback;
    }

    const margins = {};

    for (const side of [
      "top", "right", "bottom", "left"
    ]) {
      margins[side] = bounded(
        input.margins?.[side],
        DEFAULTS.margins[side],
        5,
        40
      );
    }

    return {
      paper: input.paper === "Letter"
        ? "Letter"
        : "A4",

      orientation:
        input.orientation === "landscape"
          ? "landscape"
          : "portrait",

      margins,

      defaultFont: FONTS.includes(
        input.defaultFont
      )
        ? input.defaultFont
        : DEFAULTS.defaultFont,

      defaultFontSize: bounded(
        input.defaultFontSize,
        11,
        6,
        72
      ),

      lineHeight: bounded(
        input.lineHeight,
        1.5,
        1,
        3
      )
    };
  }

  function addStyles() {
    if (
      document.getElementById(
        "mr-richtext-styles"
      )
    ) {
      return;
    }

    const style = document.createElement("style");

    style.id = "mr-richtext-styles";

    style.textContent = `
      .manager-report-main .mr-rich-settings {
        display:grid;
        grid-template-columns:repeat(2,minmax(0,1fr));
        gap:10px;
        margin:0 0 12px;
        padding:12px;
        border:1px solid #e5e7eb;
        border-radius:9px;
        background:#fafbfc;
      }

      .manager-report-main .mr-rich-settings label {
        display:grid;
        gap:5px;
        margin:0;
        font-size:12px;
      }

      .manager-report-main .mr-rich-settings input,
      .manager-report-main .mr-rich-settings select {
        width:100%;
        min-width:0;
        padding:7px;
        font-size:12px;
      }

      .manager-report-main .jodit-container {
        max-width:100%;
        border-radius:9px;
      }

      .manager-report-main .jodit-container button {
        min-height:26px;
        margin:0;
        padding:3px 6px;
        border:0;
        box-shadow:none;
        transform:none;
      }

      .manager-report-main .jodit-wysiwyg img,
      .manager-report-main .mr-document-content img {
        max-width:100%;
      }

      .manager-report-main .jodit-wysiwyg table,
      .manager-report-main .mr-document-content table {
        width:100%;
        border-collapse:collapse;
      }

      .manager-report-main .mr-document-content td,
      .manager-report-main .mr-document-content th {
        padding:7px;
        border:1px solid #9ca3af;
        vertical-align:top;
        overflow-wrap:anywhere;
      }

      .manager-report-main .mr-document-content {
        white-space:normal;
      }

      .manager-report-main .mr-document-content p {
        margin:0 0 .7em;
      }

      .manager-report-main .mr-document-content blockquote {
        margin:12px 0;
        padding-left:14px;
        border-left:3px solid #d1d5db;
      }

      .manager-report-main .mr-page-break {
        margin:14px 0;
        padding:6px;
        border-top:2px dashed #cbd5e1;
        color:#737b84;
        font-size:11px;
        text-align:center;
      }

      @media(max-width:500px) {
        .manager-report-main .mr-rich-settings {
          grid-template-columns:minmax(0,1fr);
        }
      }

      @media print {
        .manager-report-main #mr-preview {
          min-height:0 !important;
          padding:0 !important;
          aspect-ratio:auto !important;
        }

        .manager-report-main .mr-page-break {
          display:block;
          height:0;
          margin:0;
          padding:0;
          border:0;
          font-size:0;
          line-height:0;
          break-after:page;
          page-break-after:always;
        }
      }
    `;

    document.head.appendChild(style);
  }

  async function create(options) {
    await loadAssets();
    addStyles();

    const textarea = options.textarea;
    const preview = options.preview;
    const paper = options.paper;

    if (!textarea || !preview || !paper) {
      throw new Error(
        "Report editor elements are missing."
      );
    }

    let muted = 0;
    let readonly = true;
    let destroyed = false;
    let editor;

    const assetUrls = new Map();
    const assetRequests = new Map();
    const settingsInputs = {};

    const settingsPanel =
      document.createElement("div");

    settingsPanel.className =
      "mr-rich-settings";

    textarea.insertAdjacentElement(
      "beforebegin",
      settingsPanel
    );

    const printStyle =
      document.createElement("style");

    document.head.appendChild(printStyle);

    function setting(
      key,
      label,
      values,
      numberOptions
    ) {
      const wrapper =
        document.createElement("label");

      wrapper.appendChild(
        document.createTextNode(label)
      );

      const input = document.createElement(
        values ? "select" : "input"
      );

      if (values) {
        for (const [value, text] of values) {
          const option =
            document.createElement("option");

          option.value = value;
          option.textContent = text;
          input.appendChild(option);
        }
      } else {
        input.type = "number";
        input.min = numberOptions.min;
        input.max = numberOptions.max;
        input.step = numberOptions.step || "1";
      }

      input.disabled = true;

      input.addEventListener(
        "change",
        notify
      );

      wrapper.appendChild(input);
      settingsPanel.appendChild(wrapper);

      settingsInputs[key] = input;
    }

    setting("paper", "Paper", [
      ["A4", "A4"],
      ["Letter", "Letter"]
    ]);

    setting("orientation", "Orientation", [
      ["portrait", "Portrait"],
      ["landscape", "Landscape"]
    ]);

    setting(
      "defaultFont",
      "Default font",
      FONTS.map(font => [font, font])
    );

    setting(
      "defaultFontSize",
      "Default size (pt)",
      null,
      { min: "6", max: "72", step: "0.5" }
    );

    setting(
      "lineHeight",
      "Line spacing",
      null,
      { min: "1", max: "3", step: "0.05" }
    );

    for (const side of [
      "top", "right", "bottom", "left"
    ]) {
      setting(
        `margin_${side}`,
        `${side[0].toUpperCase()}${side.slice(1)} margin (mm)`,
        null,
        { min: "5", max: "40", step: "1" }
      );
    }

    function getSettings() {
      return normalizeSettings({
        paper: settingsInputs.paper.value,
        orientation:
          settingsInputs.orientation.value,
        defaultFont:
          settingsInputs.defaultFont.value,
        defaultFontSize: Number(
          settingsInputs.defaultFontSize.value
        ),
        lineHeight: Number(
          settingsInputs.lineHeight.value
        ),
        margins: {
          top: Number(
            settingsInputs.margin_top.value
          ),
          right: Number(
            settingsInputs.margin_right.value
          ),
          bottom: Number(
            settingsInputs.margin_bottom.value
          ),
          left: Number(
            settingsInputs.margin_left.value
          )
        }
      });
    }

    function setSettings(value) {
      const settings = normalizeSettings(value);

      for (const key of [
        "paper",
        "orientation",
        "defaultFont",
        "defaultFontSize",
        "lineHeight"
      ]) {
        settingsInputs[key].value =
          settings[key];
      }

      for (const side of [
        "top", "right", "bottom", "left"
      ]) {
        settingsInputs[
          `margin_${side}`
        ].value = settings.margins[side];
      }

      applySettings();
    }

    function applySettings() {
      const settings = getSettings();

      if (editor?.editor) {
        editor.editor.style.fontFamily =
          settings.defaultFont;

        editor.editor.style.fontSize =
          `${settings.defaultFontSize}pt`;

        editor.editor.style.lineHeight =
          String(settings.lineHeight);
      }

      paper.style.fontFamily =
        settings.defaultFont;

      preview.style.fontFamily =
        settings.defaultFont;

      preview.style.fontSize =
        `${settings.defaultFontSize}pt`;

      preview.style.lineHeight =
        String(settings.lineHeight);

      const dimensions = settings.paper === "A4"
        ? [210, 297]
        : [215.9, 279.4];

      if (settings.orientation === "landscape") {
        dimensions.reverse();
      }

      paper.style.maxWidth =
        `${dimensions[0]}mm`;

      paper.style.aspectRatio =
        `${dimensions[0]} / ${dimensions[1]}`;

      const margins = settings.margins;

      printStyle.textContent = `
        @page {
          size:${settings.paper} ${settings.orientation};
          margin:${margins.top}mm ${margins.right}mm
            ${margins.bottom}mm ${margins.left}mm;
        }
      `;
    }

    function getDocument() {
      return documentFromDOM(
        editor.editor
      );
    }

    function getPlainText() {
      return plainText(
        getDocument()
      );
    }

    async function imageUrl(id) {
      const reportId =
        options.getReportId?.();

      if (!validId(reportId)) {
        throw new Error(
          "Save the report before loading its images."
        );
      }

      const key = `${reportId}:${id}`;

      if (assetUrls.has(key)) {
        return assetUrls.get(key);
      }

      if (!assetRequests.has(key)) {
        const pending = (async () => {
          const response = await fetch(
            `/api/manager-reports/${reportId}/files/${id}`,
            {
              credentials: "same-origin",
              cache: "no-store",
              signal: AbortSignal.timeout(20000)
            }
          );

          if (!response.ok) {
            throw new Error(
              "A report image could not be loaded."
            );
          }

          const blob = await response.blob();

          if (
            !["image/png", "image/jpeg"].includes(
              blob.type
            ) ||
            blob.size > 5 * 1024 * 1024
          ) {
            throw new Error(
              "Invalid report image."
            );
          }

          const url = URL.createObjectURL(blob);

          assetUrls.set(key, url);

          return url;
        })();

        assetRequests.set(key, pending);

        pending.catch(() => {
          assetRequests.delete(key);
        });
      }

      return assetRequests.get(key);
    }

    async function hydrateImages() {
      const images = [
        ...editor.editor.querySelectorAll(
          "img[data-report-attachment-id]"
        ),
        ...preview.querySelectorAll(
          "img[data-report-attachment-id]"
        )
      ];

      await Promise.all(
        images.map(async image => {
          const id = image.getAttribute(
            "data-report-attachment-id"
          );

          if (!validId(id)) return;

          const url = await imageUrl(id);

          if (!image.isConnected) return;

          if (image.getAttribute("src") !== url) {
            image.src = url;
          }

          if (image.decode) {
            await image.decode().catch(() => {});
          }
        })
      );
    }

    function renderPreview(title = "") {
      const source = getDocument();
      const nodes = [...source.nodes];

      if (nodes.length && title) {
        const first = nodes[0];

        if (
          first.type === "element" &&
          [
            "p", "div",
            "h1", "h2", "h3"
          ].includes(first.tag) &&
          plainText({
            version: 1,
            nodes: [first]
          }) === title.trim()
        ) {
          nodes.shift();
        }
      }

      const container = createDOM({
        version: 1,
        nodes
      });

      preview.replaceChildren(
        ...container.childNodes
      );

      applySettings();

      hydrateImages().catch(error => {
        options.onError?.(error);
      });
    }

    function notify() {
      if (
        muted ||
        destroyed ||
        readonly
      ) {
        return;
      }

      try {
        textarea.value = getPlainText();

        applySettings();

        if (options.onChange) {
          options.onChange();
        } else {
          textarea.dispatchEvent(
            new Event("input", {
              bubbles: true
            })
          );
        }
      } catch (error) {
        options.onError?.(error);
      }
    }

    function selectionRange() {
      const selection = window.getSelection();

      if (!selection?.rangeCount) {
        return null;
      }

      const range =
        selection.getRangeAt(0);

      return editor.editor.contains(
        range.commonAncestorContainer
      )
        ? range.cloneRange()
        : null;
    }

    function restoreRange(range) {
      editor.editor.focus();

      const selection = window.getSelection();

      if (
        range &&
        editor.editor.contains(
          range.commonAncestorContainer
        )
      ) {
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        const end = document.createRange();

        end.selectNodeContents(editor.editor);
        end.collapse(false);

        selection.removeAllRanges();
        selection.addRange(end);
      }
    }

    async function insertImage(file, range) {
      if (readonly || destroyed) return;

      if (
        !file ||
        !["image/png", "image/jpeg"].includes(
          file.type
        ) ||
        !file.size ||
        file.size > 5 * 1024 * 1024
      ) {
        options.onError?.(
          new Error(
            "Choose a PNG or JPG image up to 5 MB."
          )
        );

        return;
      }

      try {
        if (!options.onUploadImage) {
          throw new Error(
            "Image upload is not connected."
          );
        }

        const asset =
          await options.onUploadImage(file);

        if (
          !asset ||
          destroyed
        ) {
          return;
        }

        if (!validId(asset.id)) {
          throw new Error(
            "The server returned an invalid image ID."
          );
        }

        restoreRange(range);

        const image =
          document.createElement("img");

        image.setAttribute(
          "data-report-attachment-id",
          asset.id
        );

        image.alt =
          asset.original_name || file.name;

        image.style.width = "100%";

        image.src = await imageUrl(asset.id);

        editor.selection.insertNode(image);

        notify();
      } catch (error) {
        options.onError?.(error);
      }
    }

    function chooseImage() {
      if (readonly) return;

      const range = selectionRange();

      const picker =
        document.createElement("input");

      picker.type = "file";
      picker.accept = "image/png,image/jpeg";

      picker.addEventListener(
        "change",
        () => insertImage(
          picker.files[0],
          range
        ),
        { once: true }
      );

      picker.click();
    }

    editor = window.Jodit.make(
      textarea,
      {
        height: 440,
        minHeight: 340,
        readonly: true,
        iframe: false,
        toolbarAdaptive: false,
        toolbarSticky: false,
        showXPathInStatusbar: false,
        showCharsCounter: true,
        showWordsCounter: true,

        buttons: [
          "bold",
          "italic",
          "underline",
          "strikethrough",
          "superscript",
          "subscript",
          "|",
          "font",
          "fontsize",
          "brush",
          "paragraph",
          "|",
          "ul",
          "ol",
          "outdent",
          "indent",
          "align",
          "|",
          "table",
          "link",
          {
            name: "reportImage",
            text: "Image",
            tooltip: "Upload and insert an image",
            exec: chooseImage
          },
          {
            name: "reportPageBreak",
            text: "Page Break",
            tooltip: "Insert a page break",
            exec: () => {
              if (readonly) return;

              editor.selection.insertHTML(
                '<div data-report-page-break="true" ' +
                'class="mr-page-break" contenteditable="false">' +
                'Page break</div><p><br></p>'
              );

              notify();
            }
          },
          "|",
          "hr",
          "eraser",
          "undo",
          "redo",
          "fullsize"
        ],

        controls: {
          font: {
            list: Object.fromEntries(
              FONTS.map(font => [
                font,
                font
              ])
            )
          }
        }
      }
    );

    editor.editor.setAttribute(
      "aria-label",
      "Report content"
    );

    editor.events.on(
      "change",
      notify
    );

    editor.editor.addEventListener(
      "paste",
      event => {
        if (readonly) return;

        const clipboard = event.clipboardData;

        if (!clipboard) return;

        const html = clipboard.getData(
          "text/html"
        );

        const text = clipboard.getData(
          "text/plain"
        );

        const file = clipboard.files?.[0];

        if (
          !html &&
          !text &&
          file
        ) {
          event.preventDefault();
          event.stopImmediatePropagation();

          insertImage(
            file,
            selectionRange()
          );

          return;
        }

        if (!html && !text) return;

        event.preventDefault();
        event.stopImmediatePropagation();

        try {
          let value;

          if (html) {
            const parsed =
              new DOMParser().parseFromString(
                html,
                "text/html"
              );

            value = documentFromDOM(
              parsed.body
            );
          } else {
            value = plainDocument(text);
          }

          const safe = createDOM(value);

          editor.selection.insertHTML(
            safe.innerHTML
          );

          notify();

          hydrateImages().catch(error => {
            options.onError?.(error);
          });
        } catch (error) {
          options.onError?.(error);
        }
      },
      true
    );

    async function setDocument(
      documentValue,
      text,
      settings
    ) {
      muted++;

      try {
        const value = documentValue ||
          plainDocument(text);

        setSettings(settings);

        const container = createDOM(value);

        editor.value = container.innerHTML;

        textarea.value = getPlainText();

        renderPreview();

        await hydrateImages();
      } finally {
        muted--;
      }
    }

    function setReadonly(value) {
      readonly = Boolean(value);

      editor.setReadOnly(readonly);

      for (const input of Object.values(
        settingsInputs
      )) {
        input.disabled = readonly;
      }
    }

    function destroy() {
      if (destroyed) return;

      destroyed = true;

      for (const url of assetUrls.values()) {
        URL.revokeObjectURL(url);
      }

      assetUrls.clear();
      assetRequests.clear();

      editor.destruct();
      settingsPanel.remove();
      printStyle.remove();
    }

    setSettings(DEFAULTS);
    setReadonly(true);

    window.addEventListener(
      "pagehide",
      event => {
        if (!event.persisted) destroy();
      }
    );

    return {
      getDocument,
      getPlainText,
      getPageSettings: getSettings,
      setDocument,
      setReadonly,
      renderPreview,
      whenImagesReady: hydrateImages,
      destroy
    };
  }

  window.ManagerReportRichText = {
    create
  };
})();
