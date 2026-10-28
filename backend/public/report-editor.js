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
    let rich = null;
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

      rich?.setReadonly(editLocked);

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
      const input = {
        title: fields.title.value.trim(),
        report_type: fields.report_type.value,
        period_start: fields.period_start.value,
        period_end: fields.period_end.value,
        content: rich
          ? rich.getPlainText()
          : fields.content.value
      };

      if (rich) {
        input.editor_document =
          rich.getDocument();

        input.page_settings =
          rich.getPageSettings();
      }

      return input;
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
      const title =
        fields.title.value.trim();

      get("preview-title").textContent =
        title || "Untitled Report";

      get("preview-type").textContent =
        TYPE_LABELS[
          fields.report_type.value
        ] || "General Operations";

      get("preview-period").textContent =
        fields.period_start.value &&
        fields.period_end.value
          ? `${fields.period_start.value} to ${fields.period_end.value}`
          : "—";

      get("preview-author").textContent =
        session?.user?.full_name || "—";

      get("preview-created").textContent =
        dateTime(
          report?.submitted_at ||
          report?.created_at ||
          new Date().toISOString()
        );

      if (rich) {
        rich.renderPreview(title);
      } else {
        get("preview-content").textContent =
          fields.content.value.trim()
            ? fields.content.value
            : "Your report content will appear here.";
      }

      const snapshot =
        report?.data_snapshot;

      if (
        snapshot &&
        !contextChanged()
      ) {
        get("preview-source").textContent =
          `System data snapshot: ${
            dateTime(snapshot.generated_at)
          }. ${snapshot.basis || ""}`;

        get("data-status").textContent =
          snapshot.draft_method === "gemini"
            ? `AI draft based on system data generated at ${dateTime(snapshot.generated_at)}.`
            : `System data generated at ${dateTime(snapshot.generated_at)}.`;
      } else {
        get("preview-source").textContent = "";

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

    async function applyReport(
      data,
      { replaceEditor = true } = {}
    ) {
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

      fields.title.value = report.title;
      fields.report_type.value =
        report.report_type;
      fields.period_start.value =
        report.period_start;
      fields.period_end.value =
        report.period_end;
      fields.period_end.min =
        report.period_start;

      if (replaceEditor) {
        fields.content.value =
          report.content;

        if (rich) {
          await rich.setDocument(
            report.editor_document || null,
            report.content,
            report.page_settings || null
          );
        }
      }

      dirty = false;
      uncertain = false;

      const url = new URL(location.href);

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

    async function loadReport(
      { replaceEditor = true } = {}
    ) {
      if (!report) return;

      const result = await api(
        `/${report.id}`
      );

      await applyReport(
        result.data,
        { replaceEditor }
      );
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

        await applyReport(
          result.data,
          { replaceEditor: false }
        );

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

        await applyReport(
          result.data,
          { replaceEditor: false }
        );
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

                report.version = Number(
                  result.report_version
                );

                report.files =
                  report.files.filter(
                    item =>
                      item.id !== file.id
                  );

                renderFiles();

                await loadReport({
                  replaceEditor: false
                });

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

    function validateFiles(files) {
      const existing =
        report?.files?.length || 0;

      if (
        files.length + existing > 3
      ) {
        throw new Error(
          "A report can contain up to 3 attachments, including inserted images."
        );
      }

      for (const file of files) {
        if (
          !file.size ||
          file.size > 5 * 1024 * 1024
        ) {
          throw new Error(
            "Choose non-empty files up to 5 MB each."
          );
        }

        if (
          file.name.length > 255 ||
          !fileContentType(file)
        ) {
          throw new Error(
            "Choose PDF, PNG or JPG files with valid filenames."
          );
        }
      }
    }

    async function uploadFile(file) {
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

      report.version = Number(
        result.report_version
      );

      report.files.push(
        result.data
      );

      renderFiles();

      return result.data;
    }

    async function uploadEditorImage(file) {
      if (
        !ready ||
        busy ||
        readonly() ||
        uncertain
      ) {
        return null;
      }

      if (!inputValid()) return null;

      let asset = null;

      await run(async () => {
        validateFiles([file]);

        message(
          "Uploading report image..."
        );

        await ensureSaved();

        asset = await uploadFile(file);

        message(
          "Image uploaded. Save Draft after inserting it."
        );
      });

      return asset;
    }

    form.addEventListener(
      "submit",
      event => {
        event.preventDefault();

        if (!inputValid()) return;

        run(async () => {
          message("Saving draft...");

          await ensureSaved();

          message(
            "Draft and formatting saved."
          );
        });
      }
    );

    get("generate").addEventListener(
      "click",
      () => {
        if (!inputValid()) return;

        if (
          currentInput().content.trim() &&
          !confirm(
            "Generate a new data draft? This replaces the current report content and its formatting."
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

          await applyReport({
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
          currentInput().content.trim() &&
          !confirm(
            "Create an AI draft? This replaces the current report content and its formatting."
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

          await applyReport({
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

        run(async () => {
          validateFiles(selected);

          await ensureSaved();

          for (
            const [index, file]
            of selected.entries()
          ) {
            message(
              `Uploading ${index + 1} of ${selected.length}...`
            );

            await uploadFile(file);
          }

          get("files").value = "";

          await loadReport({
            replaceEditor: false
          });

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
          !currentInput().content.trim() &&
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

          await applyReport(
            result.data
          );

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
        run(async () => {
          updatePreview();

          if (rich) {
            await rich.whenImagesReady();
          }

          document.title = (
            fields.title.value.trim() ||
            "Report"
          ).replace(
            /[\\/:*?"<>|]/g,
            "-"
          );

          window.print();
        });
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

    function changed() {
      dirty = true;

      fields.period_end.min =
        fields.period_start.value;

      try {
        updatePreview();
      } catch (error) {
        message(
          error.message,
          true
        );
      }

      controls();
    }

    for (
      const element
      of Object.values(fields)
    ) {
      element.addEventListener(
        "input",
        changed
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

        if (
          !window.ManagerReportRichText?.create
        ) {
          throw new Error(
            "The rich text editor script is missing. Refresh the page."
          );
        }

        message(
          "Loading rich text editor..."
        );

        rich =
          await window.ManagerReportRichText.create({
            textarea: fields.content,
            preview: get("preview-content"),
            paper: get("preview"),

            getReportId: () =>
              report?.id || null,

            onChange: () => {
              if (!rich) return;

              fields.content.dispatchEvent(
                new Event("input", {
                  bubbles: true
                })
              );
            },

            onUploadImage:
              uploadEditorImage,

            onError: error => {
              if (
                ready &&
                !readonly() &&
                !busy
              ) {
                dirty = true;
              }

              message(
                error.message,
                true
              );

              controls();
            }
          });

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

          await applyReport(
            loaded.data
          );
        } else {
          await rich.setDocument(
            null,
            "",
            null
          );
        }

        ready = true;
        dirty = false;

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
