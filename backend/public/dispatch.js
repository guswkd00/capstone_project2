const orderSelect = document.getElementById("dispatch-order");
const refreshDispatch = document.getElementById("refresh-dispatch");
const dispatchMessage = document.getElementById("dispatch-message");
const orderSummary = document.getElementById("order-summary");
const candidateList = document.getElementById("candidate-list");

let loadingDispatch = false;

async function requestJson(url) {
  const response = await fetch(url);
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.message || "Unable to load dispatch information.");
  }

  return result;
}

function element(tag, text, className = "") {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function formatNumber(value, suffix = "") {
  if (value === null || value === undefined) return "—";

  const number = Number(value);
  return Number.isFinite(number)
    ? number.toFixed(2) + suffix
    : "—";
}

function showDeadline(value) {
  if (!value) return "—";

  const utcValue = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? value.replace(" ", "T") + "Z"
    : value;

  return new Date(utcValue).toLocaleString("en-GB");
}

function candidateCard(candidate, recommendedId, assignedDriverId) {
  const isRecommended = candidate.id === recommendedId;

  const card = document.createElement("article");
  card.className = "card";
  card.dataset.driverId = String(candidate.id);

  if (isRecommended) card.classList.add("recommended");
  if (!candidate.eligible) card.classList.add("ineligible");

  const header = document.createElement("div");
  header.className = "card-header";

  header.appendChild(
    element("h2", `${candidate.full_name} · ${candidate.plate_number}`)
  );

  const label = !candidate.eligible
    ? "Ineligible"
    : isRecommended
      ? "Recommended"
      : "Eligible alternative";

  header.appendChild(
    element(
      "span",
      label,
      "badge" + (
        !candidate.eligible
          ? " ineligible"
          : isRecommended
            ? " recommended"
            : ""
      )
    )
  );

  card.appendChild(header);

  card.appendChild(
    element(
      "p",
      `${candidate.driver_code} · ${candidate.service_zone}`,
      "muted"
    )
  );

  const stats = document.createElement("div");
  stats.className = "stats";

  const values = [
    ["Decision Score", formatNumber(candidate.score)],
    ["Pickup Distance", formatNumber(candidate.pickup_km, " km")],
    [
      "Estimated Delivery",
      candidate.eta_minutes === null
        ? "—"
        : `${candidate.eta_minutes} min`
    ],
    ["Active Orders", `${candidate.active_orders} / 3`]
  ];

  for (const [title, value] of values) {
    const item = document.createElement("div");
    item.append(
      element("small", title),
      element("strong", value)
    );
    stats.appendChild(item);
  }

  card.appendChild(stats);
  card.appendChild(element("p", candidate.explanation, "muted"));

  if (!candidate.eligible) {
    const reasons = document.createElement("ul");
    reasons.className = "error";

    for (const reason of candidate.reasons) {
      reasons.appendChild(element("li", reason));
    }

    card.appendChild(reasons);
  } else if (candidate.late_minutes > 0) {
    card.appendChild(
      element(
        "p",
        `Late-delivery risk: ${candidate.late_minutes} minutes.`,
        "error"
      )
    );
  } else {
    card.appendChild(
      element("p", "Deadline feasible in the model.", "success")
    );
  }
  if (candidate.eligible) {
    const assignButton = document.createElement("button");

    const alreadyAssigned =
  assignedDriverId !== null &&
  assignedDriverId !== undefined &&
  Number(candidate.id) === Number(assignedDriverId);

assignButton.textContent = alreadyAssigned
  ? "Currently Assigned"
  : isRecommended
    ? "Approve Recommendation"
    : "Assign with Reason";

assignButton.disabled = alreadyAssigned;

    assignButton.addEventListener("click", async () => {
      assignButton.disabled = true;

      try {
        await approveAssignment(candidate.id);
      } finally {
        assignButton.disabled = false;
      }
    });

    card.appendChild(assignButton);
  }
  return card;
}

async function loadRecommendations() {
  if (loadingDispatch || !orderSelect.value) return;

  loadingDispatch = true;
  orderSelect.disabled = true;
  refreshDispatch.disabled = true;
  dispatchMessage.className = "muted";
  dispatchMessage.textContent = "Calculating recommendations...";
  orderSummary.hidden = true;
  candidateList.replaceChildren();

  try {
    const tracking = await requestJson(
      `/api/dispatch/${orderSelect.value}/tracking`
    );

    if (
      ["delivering", "completed", "failed"].includes(
        tracking.order.status
      )
    ) {
      if (typeof window.renderDeliveryTracking !== "function") {
        throw new Error(
          "Delivery tracking did not load. Refresh this page."
        );
      }

      window.renderDeliveryTracking(tracking);

      dispatchMessage.textContent =
        `Order ${tracking.order.order_code}: ` +
        `${tracking.order.status}. ` +
        "This order is shown for tracking, not assignment.";

      return;
    }

    const result = await requestJson(
      `/api/dispatch/${orderSelect.value}/recommendations`
    );

    const order = result.order;
    window.renderDispatchMap?.(result);

    document.getElementById("order-title").textContent =
      `${order.order_code} · ${order.customer_name}`;

    document.getElementById("order-description").textContent =
  `Pickup: ${order.restaurant_name} — ${order.pickup_address}. ` +
  `Deliver to: ${order.delivery_address}. ` +
  `Weight: ${order.weight_kg} kg · Zone: ${order.service_zone}`;

    document.getElementById("order-deadline").textContent =
      `Delivery deadline: ${showDeadline(order.due_at)} · Status: ${order.status}`;

    orderSummary.hidden = false;

    for (const candidate of result.candidates) {
      candidateList.appendChild(
        candidateCard(
  candidate,
  result.recommended_driver_id,
  result.order.status === "assigned"
    ? result.order.driver_id
    : null
)
      );
    }
    document.getElementById("ai-review-note")?.remove();

    const review = new URLSearchParams(window.location.search);
    const reviewOrderId = Number(review.get("order"));
    const reviewDriverId = Number(review.get("driver"));

    if (
      Number.isSafeInteger(reviewOrderId) &&
      reviewOrderId > 0 &&
      Number.isSafeInteger(reviewDriverId) &&
      reviewDriverId > 0 &&
      String(reviewOrderId) === orderSelect.value
    ) {
      const selected = result.candidates.find(
        driver => Number(driver.id) === reviewDriverId
      );

      const card = candidateList.querySelector(
        `[data-driver-id="${reviewDriverId}"]`
      );

      const note = element("p", "", "notice");
      note.id = "ai-review-note";

      if (!selected || !card) {
        note.textContent =
          "The requested driver is no longer in the candidate list. Review the current candidates.";

        orderSummary.appendChild(note);
      } else {
        note.textContent =
          Number(order.driver_id) === reviewDriverId
            ? "This driver is currently assigned to this order."
            : selected.eligible
              ? "Selected for Manager review. Check the current facts before approving."
              : "This driver is currently ineligible. Review the reasons; assignment is not allowed.";

        card.prepend(note);
        card.style.outline = "3px solid #ee4d2d";
        card.style.outlineOffset = "3px";

        const group = candidateList.closest("details");
        if (group) group.open = true;

        requestAnimationFrame(() => {
          card.scrollIntoView({ block: "center" });
        });
      }
    }
    const eligibleCount = result.candidates.filter(
      candidate => candidate.eligible
    ).length;

    dispatchMessage.textContent = eligibleCount
      ? `${eligibleCount} eligible drivers found.`
      : "No eligible drivers. Review fleet availability, capacity and service zones.";
  } catch (error) {
    dispatchMessage.className = "error";
    dispatchMessage.textContent = error.message;
  } finally {
    loadingDispatch = false;
    orderSelect.disabled = false;
    refreshDispatch.disabled = false;
  }
}

async function loadDispatchOrders() {
  orderSelect.disabled = true;
  refreshDispatch.disabled = true;
  dispatchMessage.textContent = "Loading orders...";
  orderSelect.replaceChildren();

  try {
    const result = await requestJson("/api/orders");

    const orders = result.data.filter(order =>
      [
  "pending",
  "confirmed",
  "assigned",
  "delivering",
  "completed",
  "failed"
].includes(order.status)
    );

    for (const order of orders) {
      const option = document.createElement("option");
      option.value = order.id;
      option.textContent = `${order.order_code} — ${order.customer_name}`;
      orderSelect.appendChild(option);
    }

      if (!orders.length) {
      dispatchMessage.textContent = "No orders are ready for dispatch.";
      return;
    }

    const requested = new URLSearchParams(
      window.location.search
    ).get("order");

    if (requested !== null) {
      const requestedId = Number(requested);

      if (
        !Number.isSafeInteger(requestedId) ||
        requestedId <= 0 ||
        !orders.some(order => Number(order.id) === requestedId)
      ) {
        orderSelect.selectedIndex = -1;
        dispatchMessage.className = "error";
        dispatchMessage.textContent =
          "The requested order is not available. Select another order to continue.";
        return;
      }

      orderSelect.value = String(requestedId);
    }

    await loadRecommendations();
  } catch (error) {
    dispatchMessage.className = "error";
    dispatchMessage.textContent = error.message;
  } finally {
    orderSelect.disabled = false;
    refreshDispatch.disabled = false;
  }
}

orderSelect.addEventListener("change", loadRecommendations);

refreshDispatch.addEventListener("click", () => {
  if (orderSelect.value) {
    loadRecommendations();
  } else {
    loadDispatchOrders();
  }
});

loadDispatchOrders();
let assigningDispatch = false;

async function approveAssignment(driverId) {
  if (assigningDispatch || loadingDispatch) return;

  assigningDispatch = true;
  orderSelect.disabled = true;
  refreshDispatch.disabled = true;

  try {
    const current = await requestJson(
      `/api/dispatch/${orderSelect.value}/recommendations`
    );

    if (
      current.order.status === "assigned" &&
      current.order.driver_id === driverId
    ) {
      throw new Error("This order is already assigned to this driver.");
    }

    const needsReason =
      current.recommended_driver_id !== driverId ||
      current.order.status === "assigned";

    let reason = "";

    if (needsReason) {
      const entered = window.prompt(
        "Enter the reason for selecting an alternative or reassigning this order:"
      );

      if (entered === null) return;

      reason = entered.trim();

      if (!reason || reason.length > 500) {
        throw new Error("Enter a reason of 1–500 characters.");
      }
    }

    const response = await fetch(
      `/api/dispatch/${orderSelect.value}/assign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driver_id: driverId,
          reason
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Assignment failed.");
    }

    await loadRecommendations();

    dispatchMessage.className = "success";
    dispatchMessage.textContent =
      `${result.message} Driver: ${result.data.driver_name}`;
  } catch (error) {
    dispatchMessage.className = "error";
    dispatchMessage.textContent = error.message;
  } finally {
    assigningDispatch = false;
    orderSelect.disabled = false;
    refreshDispatch.disabled = false;
  }
}
