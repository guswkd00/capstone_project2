(() => {
  "use strict";

  const BASE = "/api/manager-reports";

  const TYPE_LABELS = new Map([
    ["delivery", "Delivery Operations"],
    ["cod", "COD"],
    ["maintenance", "Vehicle Maintenance"],
    ["expense", "Expenses"],
    ["incident", "Incidents"],
    ["general", "General Operations"]
  ]);

  function init() {
    const get = id =>
      document.getElementById(`ml-${id}`);

    const form = get("filter-form");

    if (!form || form.dataset.ready) return;

    form.dataset.ready = "true";

    let session = null;
    let ready = false;
    let busy = false;
    let rows = [];
    let cursor = null;
    let generation = 0;
    let queuedRefresh = false;
    let searchTimer = null;

    function validId(value) {
      return (
        typeof value === "string" &&
        /^[1-9][0-9]{0,19}$/.test(value) &&
        BigInt(value) <= 18446744073709551615n
      );
    }

    function node(
      tag,
      text,
      className = ""
    ) {
      const element =
        document.createElement(tag);

      if (text != null) {
        element.textContent = String(text);
      }

      element.className = className;

      return element;
    }

    function message(text, error = false) {
      get("message").textContent = text;

      get("message").classList.toggle(
        "mr-error",
        error
      );
    }

    function controls() {
      get("search").disabled = !ready;
      get("type").disabled = !ready;
      get("status").disabled = !ready;

      get("refresh").disabled =
        !ready || busy;

      get("more").disabled =
        !ready || busy || !cursor;

      get("more").hidden = !cursor;

      get("rows")
        .querySelectorAll("button")
        .forEach(button => {
          button.disabled =
            !ready || busy;
        });
    }

    function filterQuery() {
      return new URLSearchParams({
        q: get("search").value.trim(),
        type: get("type").value,
        status: get("status").value
      }).toString();
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

    async function request(
      path,
      {
        method = "GET",
        json
      } = {}
    ) {
      const headers = {};

      if (json !== undefined) {
        headers["Content-Type"] =
          "application/json";
      }

      if (
        method !== "GET" &&
        session?.csrf_token
      ) {
        headers["X-CSRF-Token"] =
          session.csrf_token;
      }

      const response = await fetch(path, {
        method,
        headers,
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),

        ...(json === undefined
          ? {}
          : {
            body: JSON.stringify(json)
          })
      });

      let result;

      try {
        result = await response.json();
      } catch {
        throw new Error(
          "The server returned an unreadable response."
        );
      }

      if (!response.ok) {
        const error = new Error(
          result.message ||
          "Unable to access reports."
        );

        error.status = response.status;

        if (
          [401, 403].includes(
            response.status
          )
        ) {
          ready = false;
        }

        throw error;
      }

      return result;
    }

    function validateList(result) {
      if (
        !result ||
        !Array.isArray(result.data) ||
        (
          result.next_before !== null &&
          !validId(result.next_before)
        ) ||
        result.data.some(report =>
          !report ||
          !validId(report.id) ||
          typeof report.title !== "string" ||
          typeof report.report_type !== "string" ||
          !["draft", "submitted"].includes(
            report.status
          ) ||
          !Number.isSafeInteger(
            Number(report.version)
          ) ||
          Number(report.version) < 1
        )
      ) {
        throw new Error(
          "The server returned invalid report data."
        );
      }
    }

    function editorLink(
      report,
      text,
      className
    ) {
      const link = node(
        "a",
        text,
        className
      );

      link.href =
        `/report-editor.html?id=${
          encodeURIComponent(report.id)
        }`;

      return link;
    }

    function render() {
      const body = get("rows");

      body.replaceChildren();

      if (!rows.length) {
        const row = node("tr");

        const filtered =
          get("search").value.trim() ||
          get("type").value !== "all" ||
          get("status").value !== "all";

        const cell = node(
          "td",
          filtered
            ? "No reports match these filters."
            : "You have not created any reports yet.",
          "mr-empty"
        );

        cell.colSpan = 6;

        row.appendChild(cell);
        body.appendChild(row);

        get("summary").textContent =
          "Showing 0 reports.";

        controls();
        return;
      }

      for (const report of rows) {
        const row = node("tr");

        const titleCell = node("td");

        titleCell.appendChild(
          editorLink(
            report,
            report.title,
            "mr-report-title"
          )
        );

        const attachmentCount = Number(
          report.attachment_count || 0
        );

        titleCell.appendChild(
          node(
            "small",
            `Report #${report.id} · ${
              attachmentCount
            } ${
              attachmentCount === 1
                ? "attachment"
                : "attachments"
            }`,
            "mr-report-secondary"
          )
        );

        const typeCell = node(
          "td",
          TYPE_LABELS.get(
            report.report_type
          ) || report.report_type
        );

        const periodCell = node("td");

        periodCell.append(
          node(
            "span",
            report.period_start || "—"
          ),
          node(
            "small",
            `to ${report.period_end || "—"}`,
            "mr-report-secondary"
          )
        );

        const statusCell = node("td");

        const submitted =
          report.status === "submitted";

        statusCell.appendChild(
          node(
            "span",
            submitted
              ? "Submitted"
              : "Draft",
            `mr-state ${
              submitted
                ? "mr-state-submitted"
                : "mr-state-draft"
            }`
          )
        );

        const updatedCell = node(
          "td",
          dateTime(
            report.updated_at
          )
        );

        const actionsCell = node("td");

        const actions = node(
          "div",
          "",
          "mr-row-actions"
        );

        actions.appendChild(
          editorLink(
            report,
            submitted
              ? "View Report"
              : "Continue Editing",
            "mr-button mr-button-secondary mr-button-small"
          )
        );

        if (!submitted) {
          const remove = node(
            "button",
            "Delete Draft",
            "mr-button mr-button-danger mr-button-small"
          );

          remove.type = "button";

          remove.addEventListener(
            "click",
            () => deleteDraft(report)
          );

          actions.appendChild(remove);
        }

        actionsCell.appendChild(actions);

        row.append(
          titleCell,
          typeCell,
          periodCell,
          statusCell,
          updatedCell,
          actionsCell
        );

        body.appendChild(row);
      }

      get("summary").textContent =
        `Showing ${rows.length} ${
          rows.length === 1
            ? "report"
            : "reports"
        }.${
          cursor
            ? " More reports are available."
            : ""
        }`;

      controls();
    }

    async function load(more = false) {
      if (!ready) return;

      if (busy) {
        if (!more) {
          queuedRefresh = true;
        }

        return;
      }

      if (more && !cursor) return;

      const token = generation;
      const query = filterQuery();

      const params = new URLSearchParams(
        query
      );

      if (more) {
        params.set(
          "before",
          cursor
        );
      }

      busy = true;
      controls();

      message(
        more
          ? "Loading more reports..."
          : "Loading your reports..."
      );

      try {
        const result = await request(
          `${BASE}?${params}`
        );

        if (
          token !== generation ||
          query !== filterQuery()
        ) {
          queuedRefresh = true;
          return;
        }

        validateList(result);

        if (more) {
          rows = [
            ...new Map(
              [
                ...rows,
                ...result.data
              ].map(report => [
                report.id,
                report
              ])
            ).values()
          ];
        } else {
          rows = result.data;
        }

        cursor =
          result.next_before;

        render();
        message("");
      } catch (error) {
        if (token === generation) {
          message(
            error.message,
            true
          );
        }
      } finally {
        busy = false;
        controls();

        if (
          queuedRefresh &&
          ready
        ) {
          queuedRefresh = false;
          load(false);
        }
      }
    }

    async function deleteDraft(report) {
      if (
        !ready ||
        busy ||
        report.status !== "draft"
      ) {
        return;
      }

      if (
        !confirm(
          `Delete draft "${report.title}" and its attachments? This cannot be undone.`
        )
      ) {
        return;
      }

      busy = true;
      controls();

      message(
        "Deleting draft..."
      );

      let deleted = false;

      try {
        await request(
          `${BASE}/${report.id}`,
          {
            method: "DELETE",
            json: {
              version:
                Number(report.version)
            }
          }
        );

        rows = rows.filter(
          item =>
            item.id !== report.id
        );

        render();
        deleted = true;

        message(
          "Draft deleted."
        );
      } catch (error) {
        const text =
          error.status === 409
            ? `${error.message} Use Refresh to reload the report list.`
            : `${error.message} Refresh the list to verify whether the draft was deleted before retrying.`;

        message(text, true);
      } finally {
        busy = false;
        controls();

        if (
          ready &&
          (
            deleted ||
            queuedRefresh
          )
        ) {
          queuedRefresh = false;
          load(false);
        }
      }
    }

    function refreshFilters() {
      clearTimeout(searchTimer);

      generation++;

      if (busy) {
        queuedRefresh = true;
      } else {
        load(false);
      }
    }

    form.addEventListener(
      "submit",
      event => {
        event.preventDefault();
        refreshFilters();
      }
    );

    get("type").addEventListener(
      "change",
      refreshFilters
    );

    get("status").addEventListener(
      "change",
      refreshFilters
    );

    get("search").addEventListener(
      "input",
      () => {
        clearTimeout(searchTimer);

        searchTimer = setTimeout(
          refreshFilters,
          300
        );
      }
    );

    get("more").addEventListener(
      "click",
      () => load(true)
    );

    window.addEventListener(
      "pagehide",
      () => clearTimeout(searchTimer)
    );

    window.addEventListener(
      "pageshow",
      event => {
        if (
          event.persisted &&
          ready
        ) {
          refreshFilters();
        }
      }
    );

    async function start() {
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
        ready = true;

        controls();

        await load(false);
      } catch (error) {
        ready = false;
        controls();

        message(
          error.message,
          true
        );
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
