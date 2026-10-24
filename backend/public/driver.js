(() => {
  "use strict";

  function initialiseDriverPage() {
    const phaseLabels = {
      assigned: "Awaiting Start",
      to_restaurant: "Travelling to Restaurant",
      at_restaurant: "At Restaurant",
      to_customer: "Delivering to Customer",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
    };

    const nextActions = {
      assigned: ["start", "Start Delivery"],
      to_restaurant: ["arrive", "Arrived at Restaurant"],
      at_restaurant: ["pickup", "Confirm Food Pickup"],
      to_customer: ["complete", "Complete Delivery"],
    };

    const actionLabels = {
      start: "Start Delivery",
      arrive: "Arrived at Restaurant",
      pickup: "Confirm Food Pickup",
      complete: "Complete Delivery",
      fail: "Report Delivery Failure",
    };

    const eventLabels = {
      delivery_started: "Delivery Started",
      restaurant_arrived: "Arrived at Restaurant",
      food_picked_up: "Food Picked Up",
      delivery_completed: "Delivery Completed",
      delivery_failed: "Delivery Failed",
    };

    let orders = [];
    let selectedTab = "active";
    let loading = false;
    let openingProgress = false;
    let savingProgress = false;
    let detailsRequest = 0;

    const style = document.createElement("style");

    style.textContent = `
      .df-driver-main {
        max-width: 1060px;
        margin: 0 auto;
        padding: 32px 20px;
        color: #203447;
        font-family: Arial, sans-serif;
      }

      .df-muted { color: #718397; }
      .df-error { color: #c62828; }
      .df-success { color: #087f5b; }

      .df-metrics {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 16px;
        margin: 24px 0;
      }

      .df-metric, .df-card {
        background: #fff;
        border: 1px solid #dce4ed;
        border-radius: 12px;
        padding: 22px;
      }

      .df-metric strong {
        display: block;
        margin-top: 12px;
        font-size: 26px;
      }

      .df-toolbar, .df-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin: 18px 0;
      }

      .df-driver-main button,
      .df-driver-dialog button,
      .df-driver-dialog a.df-button {
        border: 1px solid #d6dfeb;
        border-radius: 7px;
        padding: 11px 15px;
        background: #fff;
        color: #203447;
        font: inherit;
        cursor: pointer;
        text-decoration: none;
      }

      .df-driver-main button.df-primary,
      .df-driver-dialog button.df-primary {
        background: #fa683e;
        border-color: #fa683e;
        color: #fff;
      }

      .df-driver-dialog button.df-danger,
      .df-driver-main button.df-danger {
        color: #b42318;
        border-color: #edb3ac;
      }

      .df-driver-main button:disabled,
      .df-driver-dialog button:disabled {
        cursor: wait;
        opacity: .6;
      }

      .df-cards {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 18px;
      }

      .df-card-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 16px;
      }

      .df-card-heading h3 { margin: 0; }

      .df-badge {
        padding: 6px 9px;
        border-radius: 5px;
        background: #e8f0ff;
        color: #2457a7;
        font-size: 12px;
      }

      .df-badge.completed {
        background: #e5f5ee;
        color: #087f5b;
      }

      .df-badge.failed {
        background: #ffe9e7;
        color: #b42318;
      }

      .df-fields {
        display: grid;
        grid-template-columns: 135px minmax(0, 1fr);
        gap: 12px;
        font-size: 14px;
      }

      .df-fields dt { color: #718397; }
      .df-fields dd { margin: 0; overflow-wrap: anywhere; }

      .df-driver-dialog {
        width: min(720px, calc(100vw - 48px));
        max-height: 85vh;
        padding: 24px;
        border: 1px solid #dce4ed;
        border-radius: 12px;
        overflow-y: auto;
        color: #203447;
        background: #fff;
        font-family: Arial, sans-serif;
      }

      .df-driver-dialog::backdrop {
        background: rgba(20, 30, 40, .5);
      }

      .df-dialog-heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .df-dialog-heading h2 { margin: 0; }

      .df-table-wrap { overflow-x: auto; }

      .df-table {
        width: 100%;
        border-collapse: collapse;
        margin: 16px 0;
      }

      .df-table th, .df-table td {
        text-align: left;
        padding: 12px;
        border-bottom: 1px solid #e4eaf1;
      }

      .df-table th { background: #f6f8fa; }

      .df-progress-form {
        display: grid;
        gap: 16px;
        margin-top: 20px;
      }

      .df-form-field {
        display: grid;
        gap: 8px;
      }

      .df-form-field input,
      .df-form-field textarea {
        box-sizing: border-box;
        width: 100%;
        padding: 11px;
        border: 1px solid #d6dfeb;
        border-radius: 6px;
        font: inherit;
      }

      .df-confirmation {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        line-height: 1.5;
      }

      .df-confirmation input { margin-top: 4px; }
      .df-timeline li { margin-bottom: 16px; }

      @media (max-width: 700px) {
        .df-metrics, .df-cards { grid-template-columns: 1fr; }
        .df-fields { grid-template-columns: 115px minmax(0, 1fr); }
      }
    `;

    document.head.appendChild(style);

    // Keep the existing page header and replace its main content.
    let main = document.querySelector("main");

    if (!main) {
      main = document.createElement("main");
      document.body.appendChild(main);
    }

    const oldDialog = document.getElementById("delivery-dialog");

    if (oldDialog) oldDialog.remove();

    main.className = "df-driver-main";

    main.innerHTML = `
      <h1 id="df-greeting">My Deliveries</h1>
      <p id="df-profile" class="df-muted"></p>

      <section class="df-metrics">
        <div class="df-metric">
          <span class="df-muted">Active Deliveries</span>
          <strong id="df-active-count">0</strong>
        </div>
        <div class="df-metric">
          <span class="df-muted">Completed</span>
          <strong id="df-completed-count">0</strong>
        </div>
        <div class="df-metric">
          <span class="df-muted">COD to Collect</span>
          <strong id="df-cod-total">₫0</strong>
        </div>
      </section>

      <div class="df-toolbar">
        <button id="df-active-tab" class="df-primary" type="button">
          Active Deliveries
        </button>
        <button id="df-history-tab" type="button">
          Delivery History
        </button>
        <button id="df-refresh" type="button">Refresh</button>
      </div>

      <p id="df-message" role="status"></p>
      <p id="df-count" class="df-muted"></p>
      <section id="df-deliveries" class="df-cards"></section>
    `;

    const greeting = document.getElementById("df-greeting");
    const profileText = document.getElementById("df-profile");
    const activeCount = document.getElementById("df-active-count");
    const completedCount = document.getElementById("df-completed-count");
    const codTotal = document.getElementById("df-cod-total");
    const activeTab = document.getElementById("df-active-tab");
    const historyTab = document.getElementById("df-history-tab");
    const refreshButton = document.getElementById("df-refresh");
    const message = document.getElementById("df-message");
    const count = document.getElementById("df-count");
    const deliveries = document.getElementById("df-deliveries");

    const detailsDialog = document.createElement("dialog");
    detailsDialog.className = "df-driver-dialog";
    detailsDialog.setAttribute("aria-labelledby", "df-details-title");

    detailsDialog.innerHTML = `
      <div class="df-dialog-heading">
        <h2 id="df-details-title">Delivery Details</h2>
        <button id="df-close-details" type="button">Close</button>
      </div>
      <div id="df-details-content"></div>
    `;

    document.body.appendChild(detailsDialog);

    const detailsTitle = document.getElementById("df-details-title");
    const detailsContent = document.getElementById("df-details-content");

    const progressDialog = document.createElement("dialog");
    progressDialog.className = "df-driver-dialog";
    progressDialog.setAttribute("aria-labelledby", "df-progress-title");
    document.body.appendChild(progressDialog);

    function element(tag, text, className) {
      const item = document.createElement(tag);

      if (text != null) item.textContent = String(text);
      if (className) item.className = className;

      return item;
    }

    function money(value) {
      return new Intl.NumberFormat("vi-VN", {
        style: "currency",
        currency: "VND",
        maximumFractionDigits: 0,
      }).format(Number(value || 0));
    }

    function parseDate(value) {
      if (!value) return null;
      if (value instanceof Date) return value;

      let text = String(value);

      if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
        text = text.replace(" ", "T") + "Z";
      }

      const date = new Date(text);

      return Number.isNaN(date.getTime()) ? null : date;
    }

    function dateTime(value) {
      const date = parseDate(value);

      return date
        ? date.toLocaleString("en-GB", {
            timeZone: "Asia/Ho_Chi_Minh",
          })
        : "—";
    }

    function isActive(order) {
      return ["assigned", "delivering"].includes(order.status);
    }

    function phaseText(order) {
      return phaseLabels[order.phase] || order.status || "Unknown";
    }

    function setMessage(text, isError = false) {
      message.textContent = text;
      message.className = isError ? "df-error" : "df-success";
    }

    async function apiRequest(url, options = {}) {
      // auth-client.js supplies the session and CSRF header.
      const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
      });

      const result = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          result?.message || `Request failed (${response.status}).`
        );
      }

      if (!result) {
        throw new Error("The server returned an invalid response.");
      }

      return result;
    }

    function appendFields(parent, fields) {
      const list = element("dl", null, "df-fields");

      for (const [label, value] of fields) {
        list.append(
          element("dt", label),
          element("dd", value == null || value === "" ? "—" : value)
        );
      }

      parent.appendChild(list);
    }

    function button(label, handler, className) {
      const item = element("button", label, className);
      item.type = "button";
      item.addEventListener("click", handler);

      return item;
    }

    function actionButtons(order) {
      const container = element("div", null, "df-actions");
      const next = nextActions[order.phase];

      if (next) {
        container.appendChild(
          button(
            next[1],
            () => openProgressForm(order.id, next[0]),
            "df-primary"
          )
        );
      }

      if (order.status === "delivering") {
        container.appendChild(
          button(
            "Report Failure",
            () => openProgressForm(order.id, "fail"),
            "df-danger"
          )
        );
      }

      return container;
    }

    function renderDeliveries() {
      deliveries.replaceChildren();

      activeTab.classList.toggle("df-primary", selectedTab === "active");
      historyTab.classList.toggle("df-primary", selectedTab === "history");

      const visible = orders.filter((order) =>
        selectedTab === "active" ? isActive(order) : !isActive(order)
      );

      count.textContent = `${visible.length} deliveries found.`;

      if (!visible.length) {
        deliveries.appendChild(
          element(
            "p",
            selectedTab === "active"
              ? "No active deliveries."
              : "No delivery history yet.",
            "df-muted"
          )
        );

        return;
      }

      for (const order of visible) {
        const card = element("article", null, "df-card");
        const heading = element("div", null, "df-card-heading");

        heading.append(
          element("h3", order.order_code),
          element(
            "span",
            phaseText(order),
            `df-badge ${order.status}`
          )
        );

        card.appendChild(heading);

        appendFields(card, [
          ["Pickup", order.restaurant_name],
          ["Pickup Address", order.pickup_address],
          ["Customer", order.customer_name],
          ["Deliver To", order.delivery_address],
          ["Progress", phaseText(order)],
          ["Deadline", dateTime(order.due_at)],
          ["COD", money(order.cod_amount)],
        ]);

        const deadline = parseDate(order.due_at);

        if (isActive(order) && deadline && deadline < new Date()) {
          card.appendChild(
            element("p", "Delivery deadline has passed.", "df-error")
          );
        }

        const actions = actionButtons(order);

        actions.prepend(
          button("View Delivery Details", () => showDetails(order.id))
        );

        card.appendChild(actions);
        deliveries.appendChild(card);
      }
    }

    async function loadDeliveries() {
      if (loading) return;

      loading = true;
      refreshButton.disabled = true;
      message.textContent = "Loading deliveries...";
      message.className = "df-muted";

      try {
        const [profileResult, ordersResult] = await Promise.all([
          apiRequest("/api/driver/profile"),
          apiRequest("/api/driver/orders"),
        ]);

        const profile = profileResult.data;

        greeting.textContent = `Hello, ${profile.full_name}.`;
        profileText.textContent = [
          profile.driver_code,
          profile.plate_number || "No vehicle",
          profile.service_zone || "No service zone",
        ].join(" · ");

        orders = ordersResult.data || [];

        const active = orders.filter(isActive);

        activeCount.textContent = String(active.length);
        completedCount.textContent = String(
          orders.filter((order) => order.status === "completed").length
        );

        codTotal.textContent = money(
          active.reduce(
            (total, order) => total + Number(order.cod_amount || 0),
            0
          )
        );

        message.textContent = "";
        renderDeliveries();

        return true;
      } catch (error) {
        setMessage(error.message, true);
        return false;
      } finally {
        loading = false;
        refreshButton.disabled = false;
      }
    }

    function directionsLink(label, latitude, longitude) {
      if (latitude == null || longitude == null) return null;

      const lat = Number(latitude);
      const lng = Number(longitude);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        return null;
      }

      const link = element("a", label, "df-button");
      const url = new URL("https://www.google.com/maps/dir/");

      url.searchParams.set("api", "1");
      url.searchParams.set("destination", `${lat},${lng}`);

      link.href = url.toString();
      link.target = "_blank";
      link.rel = "noopener noreferrer";

      return link;
    }

    function appendFoodItems(parent, items) {
      parent.appendChild(element("h3", "Food Items"));

      if (!items.length) {
        parent.appendChild(element("p", "No food items recorded."));
        return;
      }

      const wrapper = element("div", null, "df-table-wrap");
      const table = element("table", null, "df-table");
      const header = element("thead");
      const heading = element("tr");

      for (const label of ["Item", "Qty", "Unit Price", "Amount"]) {
        heading.appendChild(element("th", label));
      }

      header.appendChild(heading);

      const body = element("tbody");

      for (const item of items) {
        const row = element("tr");

        row.append(
          element("td", item.item_name),
          element("td", item.quantity),
          element("td", money(item.unit_price)),
          element(
            "td",
            money(
              item.line_total ??
                Number(item.quantity) * Number(item.unit_price)
            )
          )
        );

        body.appendChild(row);
      }

      table.append(header, body);
      wrapper.appendChild(table);
      parent.appendChild(wrapper);
    }

    async function showDetails(id) {
      if (savingProgress) return;

      const request = ++detailsRequest;

      detailsTitle.textContent = "Delivery Details";
      detailsContent.replaceChildren(element("p", "Loading..."));

      if (!detailsDialog.open) detailsDialog.showModal();

      try {
        const result = await apiRequest(`/api/driver/orders/${id}`);

        if (request !== detailsRequest || !detailsDialog.open) return;

        const order = result.data;

        detailsTitle.textContent = order.order_code;
        detailsContent.replaceChildren();

        appendFields(detailsContent, [
          ["Restaurant", order.restaurant_name],
          ["Pickup Address", order.pickup_address],
          ["Restaurant Phone", order.restaurant_phone],
          ["Customer", order.customer_name],
          ["Customer Phone", order.customer_phone],
          ["Deliver To", order.delivery_address],
          ["Deadline", dateTime(order.due_at)],
          ["Progress", phaseText(order)],
          [
            "Payment",
            order.payment_method === "cash"
              ? "Cash on Delivery"
              : "Prepaid",
          ],
          ["COD Required", money(order.cod_amount)],
          [
            "COD Collected",
            order.cod_collected == null
              ? "—"
              : money(order.cod_collected),
          ],
          ["Started At", dateTime(order.started_at)],
          ["Restaurant Arrival", dateTime(order.restaurant_arrived_at)],
          ["Food Picked Up", dateTime(order.picked_up_at)],
          ["Completed At", dateTime(order.delivered_at)],
        ]);

        const directions = element("div", null, "df-actions");

        const restaurantLink = directionsLink(
          "Directions to Restaurant",
          order.pickup_latitude,
          order.pickup_longitude
        );

        const customerLink = directionsLink(
          "Directions to Customer",
          order.latitude,
          order.longitude
        );

        if (restaurantLink) directions.appendChild(restaurantLink);
        if (customerLink) directions.appendChild(customerLink);

        detailsContent.append(
          directions,
          actionButtons(order)
        );

        appendFoodItems(detailsContent, result.items || []);

        if (order.delivery_note) {
          detailsContent.append(
            element("h3", "Delivery Confirmation"),
            element("p", order.delivery_note)
          );
        }

        if (order.failure_reason) {
          detailsContent.append(
            element("h3", "Failure Reason"),
            element("p", order.failure_reason, "df-error")
          );
        }

        detailsContent.appendChild(element("h3", "Delivery Timeline"));

        if (!result.events?.length) {
          detailsContent.appendChild(
            element("p", "No delivery progress events yet.", "df-muted")
          );
        } else {
          const timeline = element("ol", null, "df-timeline");

          for (const event of result.events) {
            const item = element("li");

            item.append(
              element(
                "strong",
                eventLabels[event.event_type] ||
                  event.event_type.replaceAll("_", " ")
              ),
              element("p", event.note || ""),
              element(
                "small",
                `${dateTime(event.created_at)} · ${
                  event.actor_name || "System"
                }`,
                "df-muted"
              )
            );

            timeline.appendChild(item);
          }

          detailsContent.appendChild(timeline);
        }
      } catch (error) {
        if (request === detailsRequest && detailsDialog.open) {
          detailsContent.replaceChildren(
            element("p", error.message, "df-error")
          );
        }
      }
    }

    function formField(form, label, name, type = "text") {
      const wrapper = element("label", null, "df-form-field");
      wrapper.appendChild(element("span", label));

      const input = document.createElement(
        type === "textarea" ? "textarea" : "input"
      );

      if (type !== "textarea") input.type = type;
      else input.rows = 3;

      input.name = name;
      input.required = true;

      if (type === "text" || type === "textarea") {
        input.maxLength = 500;
      }

      wrapper.appendChild(input);
      form.appendChild(wrapper);

      return input;
    }

    async function openProgressForm(id, action) {
      if (openingProgress || savingProgress || loading) return;

      openingProgress = true;

      try {
        const result = await apiRequest(`/api/driver/orders/${id}`);
        const order = result.data;
        const expected = nextActions[order.phase]?.[0];

        if (
          (action === "fail" && order.status !== "delivering") ||
          (action !== "fail" && action !== expected)
        ) {
          await loadDeliveries();
          throw new Error(
            "The delivery stage has changed. Refresh and try again."
          );
        }

        if (detailsDialog.open) detailsDialog.close();

        progressDialog.replaceChildren();

        const title = element(
          "h2",
          `${actionLabels[action]} — ${order.order_code}`
        );

        title.id = "df-progress-title";
        progressDialog.appendChild(title);

        const descriptions = {
          start: "Confirm that you are starting this delivery.",
          arrive: "Confirm only when you have arrived at the restaurant.",
          pickup: "Check the food package and enter its matching order code.",
          complete:
            "Confirm that the customer received the food and record the collected COD.",
          fail: "Explain why the delivery could not be completed.",
        };

        progressDialog.appendChild(
          element("p", descriptions[action], "df-muted")
        );

        const form = element("form", null, "df-progress-form");

        if (action === "pickup") {
          const input = formField(
            form,
            "Order Code on the Food Package",
            "order_code"
          );

          input.maxLength = 30;
          input.placeholder = "Enter the order code";
        }

        if (action === "complete") {
          const note = formField(
            form,
            "Delivery Confirmation",
            "delivery_note",
            "textarea"
          );

          note.placeholder =
            "Example: Received by the customer at the delivery address.";

          const cod = formField(
            form,
            `Collected COD — required: ${money(order.cod_amount)}`,
            "cod_collected",
            "number"
          );

          cod.min = "0";
          cod.max = "1000000000";
          cod.step = "1";
          cod.value = order.payment_method === "cash" ? "" : "0";
cod.readOnly = order.payment_method !== "cash";

cod.placeholder = order.payment_method === "cash"
  ? "Enter the exact cash collected"
  : "Prepaid — do not collect cash";

const photo = formField(
  form,
  "Delivery Photo — choose from your computer",
  "proof_photo",
  "file"
);

photo.accept = "image/jpeg,image/png,image/webp";

form.appendChild(
  element(
    "p",
    "Choose a photo up to 15 MB. It will be compressed to 5 MB or less.",
    "df-muted"
  )
);
        }

        if (action === "fail") {
          const reason = formField(
            form,
            "Failure Reason",
            "failure_reason",
            "textarea"
          );

          reason.placeholder =
            "Describe the issue and any contact attempts.";
        }

        const confirmation = element(
          "label",
          null,
          "df-confirmation"
        );

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.required = true;

        confirmation.append(
          checkbox,
          element(
            "span",
            "I confirm that this update reflects what actually happened."
          )
        );

        form.appendChild(confirmation);

        const errorMessage = element("p", "", "df-error");
        errorMessage.setAttribute("role", "alert");

        const controls = element("div", null, "df-actions");
        const cancel = button("Cancel", () => {
          if (!savingProgress) progressDialog.close();
        });

        const submit = element(
          "button",
          actionLabels[action],
          action === "fail" ? "df-danger" : "df-primary"
        );

        submit.type = "submit";
        controls.append(cancel, submit);
        form.append(errorMessage, controls);
        progressDialog.appendChild(form);

        form.addEventListener("submit", async (event) => {
          event.preventDefault();

          if (savingProgress || !form.reportValidity()) return;

          const body = {
            action,
            ...Object.fromEntries(new FormData(form)),
          };

          if (action === "complete") {
  body.cod_collected = Number(body.cod_collected);
  delete body.proof_photo;
}

          savingProgress = true;
          errorMessage.textContent = "";

          const inputs = Array.from(form.elements);
          inputs.forEach((input) => {
            input.disabled = true;
          });

          submit.textContent = "Saving...";

          try {
  if (action === "complete") {
    if (body.cod_collected !== Number(order.cod_amount)) {
      throw new Error(
        "Collected cash must match the required COD amount."
      );
    }

    if (typeof window.prepareDeliveryPhoto !== "function") {
      throw new Error(
        "Photo helper did not load. Refresh this page."
      );
    }

    submit.textContent = "Uploading delivery photo…";

    const file = form
      .querySelector('[name="proof_photo"]')
      .files[0];

    const photoBlob = await window.prepareDeliveryPhoto(file);

    await apiRequest(`/api/driver/orders/${id}/proof`, {
      method: "POST",
      headers: {
        "Content-Type": "image/jpeg"
      },
      body: photoBlob
    });

    submit.textContent = "Confirming delivery…";
  }

  await apiRequest(`/api/driver/orders/${id}/progress`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(body),
            });

            progressDialog.close();

            const refreshed = await loadDeliveries();

            if (refreshed) {
              setMessage("Delivery progress updated successfully.");
            }
          } catch (error) {
            errorMessage.textContent = error.message;
          } finally {
            savingProgress = false;

            inputs.forEach((input) => {
              input.disabled = false;
            });

            submit.textContent = actionLabels[action];
          }
        });

        progressDialog.showModal();
      } catch (error) {
        setMessage(error.message, true);
      } finally {
        openingProgress = false;
      }
    }

    document
      .getElementById("df-close-details")
      .addEventListener("click", () => detailsDialog.close());

    detailsDialog.addEventListener("close", () => {
      detailsRequest++;
    });

    progressDialog.addEventListener("cancel", (event) => {
      if (savingProgress) event.preventDefault();
    });

    activeTab.addEventListener("click", () => {
      selectedTab = "active";
      renderDeliveries();
    });

    historyTab.addEventListener("click", () => {
      selectedTab = "history";
      renderDeliveries();
    });

    refreshButton.addEventListener("click", loadDeliveries);

    loadDeliveries();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initialiseDriverPage,
      { once: true }
    );
  } else {
    initialiseDriverPage();
  }
})();
