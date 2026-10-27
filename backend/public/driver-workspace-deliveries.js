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
    let paymentFilter = "all";
    let loading = false;
    let openingProgress = false;
    let savingProgress = false;
    let detailsRequest = 0;

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

    const detailsDialog =
      document.getElementById("df-details-dialog");

    detailsDialog.className = "df-driver-dialog";

    const detailsTitle =
      document.getElementById("df-details-title");

    const detailsContent =
      document.getElementById("df-details-content");

    const progressDialog = document.createElement("dialog");
    progressDialog.className = "df-driver-dialog";
    progressDialog.setAttribute(
      "aria-labelledby",
      "df-progress-title"
    );

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
        throw new Error(
          "The server returned an invalid response."
        );
      }

      return result;
    }

    function appendFields(parent, fields) {
      const list = element("dl", null, "df-fields");

      for (const [label, value] of fields) {
        list.append(
          element("dt", label),
          element(
            "dd",
            value == null || value === "" ? "—" : value
          )
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

      activeTab.classList.toggle(
        "df-primary",
        selectedTab === "active"
      );

      historyTab.classList.toggle(
        "df-primary",
        selectedTab === "history"
      );

      activeTab.classList.toggle(
        "active",
        selectedTab === "active"
      );

      historyTab.classList.toggle(
        "active",
        selectedTab === "history"
      );

      const visible = orders.filter(
        (order) =>
          (
            selectedTab === "active"
              ? isActive(order)
              : !isActive(order)
          ) &&
          (
            paymentFilter === "all" ||
            (
              paymentFilter === "cod"
                ? order.payment_method === "cash"
                : order.payment_method === "prepaid"
            )
          )
      );

      count.textContent =
        `${visible.length} deliveries found ` +
        "in the latest 200 assigned records.";

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
        const heading = element(
          "div",
          null,
          "df-card-heading"
        );

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
          [
            "Payment",
            order.payment_method === "cash"
              ? "Cash on delivery"
              : "Prepaid",
          ],
          ["Order total", money(order.total_amount)],
          ["Delivery fee", money(order.delivery_fee)],
          [
            "Delivery distance",
            order.delivery_distance_km == null
              ? "Coordinates unavailable"
              : `${order.delivery_distance_km} km (estimate)`,
          ],
          ["COD", money(order.cod_amount)],
        ]);

        const deadline = parseDate(order.due_at);

        if (
          isActive(order) &&
          deadline &&
          deadline < new Date()
        ) {
          card.appendChild(
            element(
              "p",
              "Delivery deadline has passed.",
              "df-error"
            )
          );
        }

        const actions = actionButtons(order);

        actions.prepend(
          button(
            "View Delivery Details",
            () => showDetails(order.id)
          )
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
        const [profileResult, ordersResult] =
          await Promise.all([
            apiRequest("/api/driver/profile"),
            apiRequest("/api/driver/orders"),
          ]);

        const profile = profileResult.data;

        greeting.textContent =
          `Hello, ${profile.full_name}.`;

        profileText.textContent = [
          profile.driver_code,
          profile.plate_number || "No vehicle",
          profile.service_zone || "No service zone",
        ].join(" · ");

        orders = ordersResult.data || [];

        document.dispatchEvent(
          new CustomEvent("driver:data", {
            detail: {
              profile,
              orders,
            },
          })
        );

        const active = orders.filter(isActive);

        activeCount.textContent = String(active.length);

        completedCount.textContent = String(
          orders.filter(
            (order) => order.status === "completed"
          ).length
        );

        codTotal.textContent = money(
          active.reduce(
            (total, order) =>
              total + Number(order.cod_amount || 0),
            0
          )
        );

        message.textContent = "";
        renderDeliveries();

        document.dispatchEvent(
          new Event("driver:updated")
        );

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
      if (latitude == null || longitude == null) {
        return null;
      }

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
      const url = new URL(
        "https://www.google.com/maps/dir/"
      );

      url.searchParams.set("api", "1");
      url.searchParams.set(
        "destination",
        `${lat},${lng}`
      );

      link.href = url.toString();
      link.target = "_blank";
      link.rel = "noopener noreferrer";

      return link;
    }

    function appendFoodItems(parent, items) {
      parent.appendChild(element("h3", "Food Items"));

      if (!items.length) {
        parent.appendChild(
          element("p", "No food items recorded.")
        );
        return;
      }

      const wrapper = element(
        "div",
        null,
        "df-table-wrap"
      );

      const table = element("table", null, "df-table");
      const header = element("thead");
      const heading = element("tr");

      for (const label of [
        "Item",
        "Qty",
        "Unit Price",
        "Amount",
      ]) {
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
                Number(item.quantity) *
                  Number(item.unit_price)
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

      detailsContent.replaceChildren(
        element("p", "Loading...")
      );

      if (!detailsDialog.open) {
        detailsDialog.showModal();
      }

      try {
        const result = await apiRequest(
          `/api/driver/orders/${id}`
        );

        if (
          request !== detailsRequest ||
          !detailsDialog.open
        ) {
          return;
        }

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
          [
            "Restaurant Arrival",
            dateTime(order.restaurant_arrived_at),
          ],
          ["Food Picked Up", dateTime(order.picked_up_at)],
          ["Completed At", dateTime(order.delivered_at)],
        ]);

        const directions = element(
          "div",
          null,
          "df-actions"
        );

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

        if (restaurantLink) {
          directions.appendChild(restaurantLink);
        }

        if (customerLink) {
          directions.appendChild(customerLink);
        }

        detailsContent.append(
          directions,
          actionButtons(order)
        );

        appendFoodItems(
          detailsContent,
          result.items || []
        );

        if (order.delivery_note) {
          detailsContent.append(
            element("h3", "Delivery Confirmation"),
            element("p", order.delivery_note)
          );
        }

        if (order.failure_reason) {
          detailsContent.append(
            element("h3", "Failure Reason"),
            element(
              "p",
              order.failure_reason,
              "df-error"
            )
          );
        }

        detailsContent.appendChild(
          element("h3", "Delivery Timeline")
        );

        if (!result.events?.length) {
          detailsContent.appendChild(
            element(
              "p",
              "No delivery progress events yet.",
              "df-muted"
            )
          );
        } else {
          const timeline = element(
            "ol",
            null,
            "df-timeline"
          );

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
                `${dateTime(event.created_at)} · ` +
                  `${event.actor_name || "System"}`,
                "df-muted"
              )
            );

            timeline.appendChild(item);
          }

          detailsContent.appendChild(timeline);
        }
      } catch (error) {
        if (
          request === detailsRequest &&
          detailsDialog.open
        ) {
          detailsContent.replaceChildren(
            element("p", error.message, "df-error")
          );
        }
      }
    }

    function formField(
      form,
      label,
      name,
      type = "text"
    ) {
      const wrapper = element(
        "label",
        null,
        "df-form-field"
      );

      wrapper.appendChild(element("span", label));

      const input = document.createElement(
        type === "textarea" ? "textarea" : "input"
      );

      if (type !== "textarea") {
        input.type = type;
      } else {
        input.rows = 3;
      }

      input.name = name;
      input.required = true;

      if (
        type === "text" ||
        type === "textarea"
      ) {
        input.maxLength = 500;
      }

      wrapper.appendChild(input);
      form.appendChild(wrapper);

      return input;
    }

    async function openProgressForm(id, action) {
      if (
        openingProgress ||
        savingProgress ||
        loading
      ) {
        return;
      }

      openingProgress = true;

      try {
        const result = await apiRequest(
          `/api/driver/orders/${id}`
        );

        const order = result.data;
        const expected = nextActions[order.phase]?.[0];

        if (
          (
            action === "fail" &&
            order.status !== "delivering"
          ) ||
          (
            action !== "fail" &&
            action !== expected
          )
        ) {
          await loadDeliveries();

          throw new Error(
            "The delivery stage has changed. Refresh and try again."
          );
        }

        if (detailsDialog.open) {
          detailsDialog.close();
        }

        progressDialog.replaceChildren();

        const title = element(
          "h2",
          `${actionLabels[action]} — ${order.order_code}`
        );

        title.id = "df-progress-title";
        progressDialog.appendChild(title);

        const descriptions = {
          start:
            "Confirm that you are starting this delivery.",
          arrive:
            "Confirm only when you have arrived at the restaurant.",
          pickup:
            "Check the food package and enter its matching order code.",
          complete:
            "Confirm that the customer received the food and record the collected COD.",
          fail:
            "Explain why the delivery could not be completed.",
        };

        progressDialog.appendChild(
          element(
            "p",
            descriptions[action],
            "df-muted"
          )
        );

        const form = element(
          "form",
          null,
          "df-progress-form"
        );

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

          cod.value =
            order.payment_method === "cash" ? "" : "0";

          cod.readOnly =
            order.payment_method !== "cash";

          cod.placeholder =
            order.payment_method === "cash"
              ? "Enter the exact cash collected"
              : "Prepaid — do not collect cash";

          const photo = formField(
            form,
            "Delivery Photo — choose from your computer",
            "proof_photo",
            "file"
          );

          photo.accept =
            "image/jpeg,image/png,image/webp";

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

        const errorMessage = element(
          "p",
          "",
          "df-error"
        );

        errorMessage.setAttribute("role", "alert");

        const controls = element(
          "div",
          null,
          "df-actions"
        );

        const cancel = button("Cancel", () => {
          if (!savingProgress) {
            progressDialog.close();
          }
        });

        const submit = element(
          "button",
          actionLabels[action],
          action === "fail"
            ? "df-danger"
            : "df-primary"
        );

        submit.type = "submit";

        controls.append(cancel, submit);
        form.append(errorMessage, controls);
        progressDialog.appendChild(form);

        form.addEventListener(
          "submit",
          async (event) => {
            event.preventDefault();

            if (
              savingProgress ||
              !form.reportValidity()
            ) {
              return;
            }

            const body = {
              action,
              ...Object.fromEntries(
                new FormData(form)
              ),
            };

            if (action === "complete") {
              body.cod_collected =
                Number(body.cod_collected);

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
                if (
                  body.cod_collected !==
                  Number(order.cod_amount)
                ) {
                  throw new Error(
                    "Collected cash must match the required COD amount."
                  );
                }

                if (
                  typeof window.prepareDeliveryPhoto !==
                  "function"
                ) {
                  throw new Error(
                    "Photo helper did not load. Refresh this page."
                  );
                }

                submit.textContent =
                  "Uploading delivery photo…";

                const file = form.querySelector(
                  '[name="proof_photo"]'
                ).files[0];

                const photoBlob =
                  await window.prepareDeliveryPhoto(file);

                await apiRequest(
                  `/api/driver/orders/${id}/proof`,
                  {
                    method: "POST",
                    headers: {
                      "Content-Type": "image/jpeg",
                    },
                    body: photoBlob,
                  }
                );

                submit.textContent =
                  "Confirming delivery…";
              }

              const endpoint =
                action === "start"
                  ? "accept"
                  : "progress";

              await apiRequest(
                `/api/driver/orders/${id}/${endpoint}`,
                {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify(body),
                }
              );

              progressDialog.close();

              const refreshed =
                await loadDeliveries();

              if (refreshed) {
                setMessage(
                  "Delivery progress updated successfully."
                );
              }
            } catch (error) {
              errorMessage.textContent =
                error.message;
            } finally {
              savingProgress = false;

              inputs.forEach((input) => {
                input.disabled = false;
              });

              submit.textContent =
                actionLabels[action];
            }
          }
        );

        progressDialog.showModal();
      } catch (error) {
        setMessage(error.message, true);
      } finally {
        openingProgress = false;
      }
    }

    document.getElementById(
      "df-close-details"
    ).addEventListener("click", () => {
      detailsDialog.close();
    });

    detailsDialog.addEventListener("close", () => {
      detailsRequest++;
    });

    progressDialog.addEventListener(
      "cancel",
      (event) => {
        if (savingProgress) {
          event.preventDefault();
        }
      }
    );

    activeTab.addEventListener("click", () => {
      selectedTab = "active";
      renderDeliveries();
    });

    historyTab.addEventListener("click", () => {
      selectedTab = "history";
      renderDeliveries();
    });

    refreshButton.addEventListener(
      "click",
      loadDeliveries
    );

    document.querySelectorAll("[data-pay]").forEach(
      (control) => {
        control.addEventListener("click", () => {
          paymentFilter = control.dataset.pay;

          document.querySelectorAll("[data-pay]").forEach(
            (item) => {
              item.classList.toggle(
                "on",
                item === control
              );
            }
          );

          renderDeliveries();
        });
      }
    );

    document.addEventListener(
      "driver:reload",
      loadDeliveries
    );

    const refreshTimer = setInterval(() => {
      if (
        !document.hidden &&
        !loading &&
        !savingProgress &&
        !openingProgress &&
        !document.querySelector("dialog[open]")
      ) {
        loadDeliveries();
      }
    }, 30000);

    window.addEventListener("pagehide", () => {
      clearInterval(refreshTimer);
    });

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
