(() => {
  "use strict";

  const BASE = "/api/manager-reports";

  const TYPE_LABELS = {
    delivery: "Delivery Operations",
    cod: "COD",
    maintenance: "Vehicle Maintenance",
    expense: "Expenses",
    incident: "Incidents",
    general: "General Operations"
  };

  function init() {
    const get = id =>
      document.getElementById(`mr-${id}`);

    const form = get("form");

    if (!form || form.dataset.ready) return;

    form.dataset.ready = "true";

    let session = null;
    let report = null;
    let ready = false;
    let busy = false;
    let dirty = false;
    let uncertain = false;

    const fields = {
      title: get("title"),
      report_type: get("type"),
      period_start: get("start"),
      period_end: get("end"),
      content: get("content")
    };

    const reloadButton =
      document.createElement("button");

    reloadButton.type = "button";
    reloadButton.className =
      "mr-button mr-button-secondary";

    reloadButton.textContent = "Reload Report";

    document.querySelector(
      ".mr-page-actions"
    ).appendChild(reloadButton);

    function validId(value) {
      return (
        typeof value === "string" &&
        /^[1-9][0-9]{0,19}$/.test(value) &&
        BigInt(value) <= 18446744073709551615n
      );
    }

    function node(tag, text, className = "") {
      const element =
        document.createElement(tag);

      if (text != null) {
        element.textContent = String(text);
      }

      element.className = className;

      return element;
    }

    function message(text, error = false) {
      get("status").textContent = text;

      get("status").classList.toggle(
        "mr-error",
        error
      );
    }

    function readonly() {
      return report?.status === "submitted";
    }

    function controls() {
      const locked = !ready || busy;
      const editLocked = locked || readonly();

      get("fields").disabled = editLocked;

      for (const id of [
        "save",
        "submit",
        "generate",
        "ai",
        "upload"
      ]) {
        get(id).disabled =
          editLocked || uncertain;
      }

      get("upload").disabled =
        editLocked ||
        uncertain ||
        !get("files").files.length;

      get("export").disabled = locked;

      get("toggle-preview").disabled = !ready;

      reloadButton.disabled =
        locked || !report;

      get("file-list")
        .querySelectorAll("button")
        .forEach(button => {
          button.disabled =
            editLocked || uncertain;
        });

      get("state").textContent =
        readonly() ? "Submitted" : "Draft";

      get("state").className =
        `mr-state ${
          readonly()
            ? "mr-state-submitted"
            : "mr-state-draft"
        }`;

      get("readonly").hidden = !readonly();

      get("dirty").textContent = uncertain
        ? "Save outcome needs verification"
        : dirty
          ? "Unsaved changes"
          : report
            ? "Saved to system"
            : "New report";

      get("page-title").textContent =
        readonly()
          ? "Submitted Report"
          : report
            ? "Edit Report"
            : "Create Report";
    }

    function vietnamDate(value = new Date()) {
      const parts = new Intl.DateTimeFormat(
        "en-GB",
        {
          timeZone: "Asia/Ho_Chi_Minh",
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }
      ).formatToParts(value);

      const values = Object.fromEntries(
        parts.map(part => [
          part.type,
          part.value
        ])
      );

      return (
        `${values.year}-` +
        `${values.month}-` +
        values.day
      );
    }

    function dateTime(value) {
      if (!value) return "—";

      const date = new Date(value);

      if (Number.isNaN(date.getTime())) {
        return "—";
      }

      return date.toLocaleString(
        "en-GB",
        {
          timeZone: "Asia/Ho_Chi_Minh"
        }
      );
    }

    function currentInput() {
      return {
        title: fields.title.value.trim(),
        report_type:
          fields.report_type.value,
        period_start:
          fields.period_start.value,
        period_end:
          fields.period_end.value,
        content:
          fields.content.value
      };
    }

    function inputValid() {
      fields.period_end.min =
        fields.period_start.value;

      return form.reportValidity();
    }

    function contextChanged() {
      if (!report) return false;

      return (
        fields.report_type.value !==
          report.report_type ||
        fields.period_start.value !==
          report.period_start ||
        fields.period_end.value !==
          report.period_end
      );
    }

    function updatePreview() {
      const input = currentInput();

      get("preview-title").textContent =
        input.title || "Untitled Report";

      get("preview-type").textContent =
        TYPE_LABELS[input.report_type] ||
        "General Operations";

      get("preview-period").textContent =
        input.period_start && input.period_end
          ? `${input.period_start} to ${input.period_end}`
          : "—";

      get("preview-author").textContent =
        session?.user?.full_name || "—";

      get("preview-created").textContent =
        dateTime(
          report?.submitted_at ||
          report?.created_at ||
          new Date().toISOString()
        );

      let content = input.content;

      const lines = content.split("\n");

      // Generated drafts may already include the report title.
      if (
        input.title &&
        lines[0]?.trim() === input.title
      ) {
        lines.shift();

        while (
          lines.length &&
          !lines[0].trim()
        ) {
          lines.shift();
        }

        content = lines.join("\n");
      }

      get("preview-content").textContent =
        content.trim()
          ? content
          : "Your report content will appear here.";

      const snapshot =
        report?.data_snapshot;

      if (snapshot && !contextChanged()) {
        const sourceText =
          `System data snapshot: ${
            dateTime(snapshot.generated_at)
          }. ${
            snapshot.basis || ""
          }`;

        get("preview-source").textContent =
          sourceText;

        get("data-status").textContent =
          snapshot.draft_method === "gemini"
            ? `AI draft based on system data generated at ${dateTime(snapshot.generated_at)}.`
            : `System data generated at ${dateTime(snapshot.generated_at)}.`;
      } else {
        get("preview-source").textContent =
          "";

        get("data-status").textContent =
          contextChanged()
            ? "Report type or dates changed. Generate a fresh data snapshot."
            : "No system data snapshot has been generated for this report.";
      }
    }

    async function request(
      path,
      {
        method = "GET",
        json,
        body,
        headers = {},
        timeout = 20000
      } = {}
    ) {
      const requestHeaders =
        new Headers(headers);

      if (
        !["GET", "HEAD", "OPTIONS"].includes(
          method
        ) &&
        session?.csrf_token
      ) {
        requestHeaders.set(
          "X-CSRF-Token",
          session.csrf_token
        );
      }

      if (json !== undefined) {
        requestHeaders.set(
          "Content-Type",
          "application/json"
        );
      }

      let response;

      try {
        response = await fetch(path, {
          method,
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(timeout),
          headers: requestHeaders,

          ...(json !== undefined
            ? {
              body: JSON.stringify(json)
            }
            : body !== undefined
              ? { body }
              : {})
        });
      } catch (cause) {
        const error = new Error(
          ["TimeoutError", "AbortError"].includes(
            cause.name
          )
            ? "The request timed out."
            : "Unable to reach the server."
        );

        error.uncertain =
          !["GET", "HEAD"].includes(method);

        throw error;
      }

      let result;

      try {
        result = await response.json();
      } catch {
        const error = new Error(
          "The server returned an unreadable response."
        );

        error.uncertain =
          !["GET", "HEAD"].includes(method);

        throw error;
      }

      if (!response.ok) {
        const error = new Error(
          result.message || "Request failed."
        );

        error.status = response.status;

        const nonIdempotent =
          method === "POST" &&
          (
            path === BASE ||
            path.includes("/files?")
          );

        error.uncertain =
          response.status >= 500 &&
          nonIdempotent;

        throw error;
      }

      return result;
    }

    const api = (path = "", options) =>
      request(
        `${BASE}${path}`,
        options
      );

    function applyReport(data) {
      if (
        !data ||
        !validId(data.id) ||
        !["draft", "submitted"].includes(
          data.status
        ) ||
        typeof data.title !== "string" ||
        typeof data.content !== "string" ||
        !Number.isSafeInteger(
          Number(data.version)
        )
      ) {
        throw new Error(
          "The server returned invalid report data."
        );
      }

      report = {
        ...data,
        version: Number(data.version),
        files: Array.isArray(data.files)
          ? data.files
          : []
      };

      fields.title.value =
        report.title;

      fields.report_type.value =
        report.report_type;

      fields.period_start.value =
        report.period_start;

      fields.period_end.value =
        report.period_end;

      fields.content.value =
        report.content;

      fields.period_end.min =
        report.period_start;

      dirty = false;
      uncertain = false;

      const url = new URL(
        location.href
      );

      url.searchParams.set(
        "id",
        report.id
      );

      history.replaceState(
        null,
        "",
        url
      );

      renderFiles();
      updatePreview();
      controls();
    }

    async function loadReport() {
      if (!report) return;

      const result = await api(
        `/${report.id}`
      );

      applyReport(result.data);
    }

    async function ensureSaved() {
      if (readonly()) {
        throw new Error(
          "Submitted reports are read-only."
        );
      }

      if (uncertain) {
        throw new Error(
          "Reload the report before making more changes."
        );
      }

      const input = currentInput();

      if (!report) {
        const result = await api(
          "",
          {
            method: "POST",
            json: input
          }
        );

        applyReport(result.data);

        return report;
      }

      if (dirty) {
        const result = await api(
          `/${report.id}`,
          {
            method: "PUT",
            json: {
              ...input,
              version: report.version
            }
          }
        );

        applyReport(result.data);
      }

      return report;
    }

    function renderFiles() {
      const list = get("file-list");

      list.replaceChildren();

      for (
        const file of report?.files || []
      ) {
        if (!validId(file.id)) continue;

        const item = node(
          "div",
          "",
          "mr-file-item"
        );

        const info = node(
          "div",
          "",
          "mr-file-info"
        );

        info.append(
          node(
            "strong",
            file.original_name
          ),
          node(
            "small",
            `${(
              Number(file.byte_size) / 1024
            ).toFixed(1)} KB`
          )
        );

        const actions = node(
          "div",
          "",
          "mr-file-actions"
        );

        const download = node(
          "a",
          "Download",
          "mr-button mr-button-secondary mr-button-small"
        );

        download.href =
          `${BASE}/${report.id}/files/${file.id}`;

        actions.appendChild(download);

        if (!readonly()) {
          const remove = node(
            "button",
            "Remove",
            "mr-button mr-button-danger mr-button-small"
          );

          remove.type = "button";

          remove.addEventListener(
            "click",
            () => {
              if (
                !confirm(
                  `Remove attachment "${file.original_name}"?`
                )
              ) {
                return;
              }

              run(async () => {
                await ensureSaved();

                const result = await api(
                  `/${report.id}/files/${file.id}`,
                  {
                    method: "DELETE",
                    json: {
                      version: report.version
                    }
                  }
                );

                report.version =
                  Number(
                    result.report_version
                  );

                report.files =
                  report.files.filter(
                    item =>
                      item.id !== file.id
                  );

                renderFiles();

                await loadReport();

                message(
                  "Attachment removed."
                );
              });
            }
          );

          actions.appendChild(remove);
        }

        item.append(
          info,
          actions
        );

        list.appendChild(item);
      }

      controls();
    }

    async function run(task) {
      if (!ready || busy) return;

      busy = true;
      controls();

      try {
        await task();
      } catch (error) {
        if (
          error.uncertain ||
          error.status === 409
        ) {
          uncertain = true;
        }

        if (
          [401, 403].includes(
            error.status
          )
        ) {
          ready = false;
        }

        let text = error.message;

        if (error.uncertain) {
          text += report
            ? " Reload Report to verify what was saved. Copy any unsaved text before reloading."
            : " Saving could not be confirmed. Check My Reports before creating another copy.";
        }

        message(text, true);
      } finally {
        busy = false;
        controls();
      }
    }

    function fileContentType(file) {
      const allowed = [
        "application/pdf",
        "image/png",
        "image/jpeg"
      ];

      if (
        allowed.includes(file.type)
      ) {
        return file.type;
      }

      const extension = file.name
        .split(".")
        .pop()
        .toLowerCase();

      return {
        pdf: "application/pdf",
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg"
      }[extension] || "";
    }

    form.addEventListener(
      "submit",
      event => {
        event.preventDefault();

        if (!inputValid()) return;

        run(async () => {
          message("Saving draft...");

          await ensureSaved();

          message("Draft saved.");
        });
      }
    );

    get("generate").addEventListener(
      "click",
      () => {
        if (!inputValid()) return;

        if (
          fields.content.value.trim() &&
          !confirm(
            "Generate a new data draft and replace the current report content?"
          )
        ) {
          return;
        }

        run(async () => {
          message(
            "Generating report from system data..."
          );

          await ensureSaved();

          const result = await api(
            `/${report.id}/generate-data`,
            {
              method: "POST",
              json: {
                version: report.version
              },
              timeout: 30000
            }
          );

          applyReport({
            ...report,
            ...result.data
          });

          message(
            result.message ||
            "Report generated from system data."
          );
        });
      }
    );

    get("ai").addEventListener(
      "click",
      () => {
        if (!inputValid()) return;

        if (
          fields.content.value.trim() &&
          !confirm(
            "Create an AI draft and replace the current report content?"
          )
        ) {
          return;
        }

        run(async () => {
          message(
            "Creating AI draft..."
          );

          await ensureSaved();

          const result = await api(
            `/${report.id}/ai-draft`,
            {
              method: "POST",
              json: {
                version: report.version,
                language:
                  get("language").value
              },
              timeout: 40000
            }
          );

          applyReport({
            ...report,
            ...result.data
          });

          message(
            result.message ||
            "AI draft saved."
          );
        });
      }
    );

    get("upload").addEventListener(
      "click",
      () => {
        if (!inputValid()) return;

        const selected = [
          ...get("files").files
        ];

        if (!selected.length) return;

        const existing =
          report?.files?.length || 0;

        if (
          selected.length + existing > 3
        ) {
          message(
            "A report can contain up to 3 attachments.",
            true
          );

          return;
        }

        for (const file of selected) {
          if (
            !file.size ||
            file.size > 5 * 1024 * 1024
          ) {
            message(
              "Choose non-empty files up to 5 MB each.",
              true
            );

            return;
          }

          if (
            file.name.length > 255 ||
            !fileContentType(file)
          ) {
            message(
              "Choose PDF, PNG or JPG files with valid filenames.",
              true
            );

            return;
          }
        }

        run(async () => {
          await ensureSaved();

          for (
            const [index, file]
            of selected.entries()
          ) {
            message(
              `Uploading ${index + 1} of ${selected.length}...`
            );

            const result = await api(
              `/${report.id}/files?name=${
                encodeURIComponent(file.name)
              }`,
              {
                method: "POST",
                body: file,
                headers: {
                  "Content-Type":
                    fileContentType(file),
                  "X-Report-Version":
                    String(report.version)
                },
                timeout: 45000
              }
            );

            report.version =
              Number(
                result.report_version
              );

            report.files.push(
              result.data
            );
          }

          get("files").value = "";

          await loadReport();

          message(
            "Attachments uploaded."
          );
        });
      }
    );

    get("submit").addEventListener(
      "click",
      () => {
        if (!inputValid()) return;

        if (
          !fields.content.value.trim() &&
          !report?.files?.length
        ) {
          message(
            "Add report content or upload an attachment before submitting.",
            true
          );

          return;
        }

        if (
          !confirm(
            "Submit this report? Submitted reports are read-only."
          )
        ) {
          return;
        }

        run(async () => {
          message(
            "Submitting report..."
          );

          await ensureSaved();

          const result = await api(
            `/${report.id}/submit`,
            {
              method: "POST",
              json: {
                version: report.version
              }
            }
          );

          applyReport(result.data);

          message(
            "Report submitted. You can view it in My Reports or export a PDF."
          );
        });
      }
    );

    get("toggle-preview").addEventListener(
      "click",
      () => {
        const workspace =
          get("workspace");

        const hide =
          workspace.dataset.previewHidden !==
          "true";

        workspace.dataset.previewHidden =
          String(hide);

        get("toggle-preview").textContent =
          hide
            ? "Show Preview"
            : "Hide Preview";

        get("toggle-preview").setAttribute(
          "aria-expanded",
          String(!hide)
        );
      }
    );

    get("export").addEventListener(
      "click",
      () => {
        if (!ready || busy) return;

        updatePreview();

        document.title = (
          fields.title.value.trim() ||
          "Report"
        ).replace(
          /[\\/:*?"<>|]/g,
          "-"
        );

        window.print();
      }
    );

    reloadButton.addEventListener(
      "click",
      () => {
        if (!report) return;

        if (
          (dirty || uncertain) &&
          !confirm(
            "Reload the saved report? Unsaved editor changes will be replaced."
          )
        ) {
          return;
        }

        run(async () => {
          message(
            "Reloading report..."
          );

          await loadReport();

          get("files").value = "";

          message(
            "Report reloaded."
          );
        });
      }
    );

    for (
      const element
      of Object.values(fields)
    ) {
      element.addEventListener(
        "input",
        () => {
          dirty = true;

          fields.period_end.min =
            fields.period_start.value;

          updatePreview();
          controls();
        }
      );
    }

    get("files").addEventListener(
      "change",
      controls
    );

    window.addEventListener(
      "beforeunload",
      event => {
        if (
          dirty ||
          busy ||
          uncertain
        ) {
          event.preventDefault();
          event.returnValue = "";
        }
      }
    );

    async function start() {
      const today = vietnamDate();

      fields.period_start.value =
        today.slice(0, 8) + "01";

      fields.period_end.value = today;

      fields.period_end.min =
        fields.period_start.value;

      updatePreview();
      controls();

      try {
        const result = await request(
          "/api/auth/me"
        );

        if (
          result.user?.role !== "manager" ||
          !result.csrf_token
        ) {
          throw new Error(
            "Manager access is required."
          );
        }

        session = result;

        const selectedId =
          new URLSearchParams(
            location.search
          ).get("id");

        if (selectedId !== null) {
          if (!validId(selectedId)) {
            throw new Error(
              "Invalid report link."
            );
          }

          const loaded = await api(
            `/${selectedId}`
          );

          applyReport(
            loaded.data
          );
        }

        ready = true;

        updatePreview();
        controls();

        message(
          readonly()
            ? "Submitted report loaded."
            : report
              ? "Draft loaded."
              : ""
        );
      } catch (error) {
        ready = false;

        message(
          error.message,
          true
        );

        controls();
      }
    }

    start();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );
  } else {
    init();
  }
})();
