(() => {
  "use strict";

  const root = document.getElementById("manager-ai-widget");
  if (!root || root.dataset.chatReady) return;
  root.dataset.chatReady = "true";

  const get = id => document.getElementById(`mai-${id}`);
  const form = get("form"), question = get("question");
  const order = get("order"), messages = get("messages");
  const status = get("status"), send = get("send");
  const refresh = get("refresh-orders"), clear = get("clear");
  const info = get("order-info");

  let history = [], orders = [], csrf = "";
  let ready = false, sending = false, loading = false;

  function node(tag, text, className = "") {
    const element = document.createElement(tag);
    element.textContent = text;
    element.className = className;
    return element;
  }

  function setStatus(text, error = false) {
    status.textContent = text;
    status.classList.toggle("mai-error", error);
  }

  function controls() {
    send.disabled =
      !ready || sending || loading || !question.value.trim();
    order.disabled = !ready || sending || loading;
    refresh.disabled = sending || loading;
    clear.disabled = !ready || sending || loading;
    question.disabled = sending;
    send.textContent = sending ? "Thinking..." : "Send";
  }

  function addMessage(label, text, user = false) {
    const article = node(
      "article",
      "",
      `mai-message ${user ? "mai-user" : "mai-assistant"}`
    );

    article.append(node("strong", label), node("p", text));
    messages.appendChild(article);

    while (messages.children.length > 30) {
      messages.firstElementChild.remove();
    }

    messages.scrollTop = messages.scrollHeight;
    return article;
  }

  function resetChat() {
    history = [];
    messages.replaceChildren();

    addMessage(
      "Dispatch Assistant",
      "Select an order to compare drivers, or ask a general workflow question."
    );

    question.value = "";
    controls();
  }

  function describeOrder() {
    const selected = orders.find(
      item => String(item.id) === order.value
    );

    info.textContent = selected
      ? `${selected.order_code} · ${selected.status}. Final assignment requires your approval.`
      : "General workflow guidance. Select an order for driver comparisons.";
  }

  function showAnswer(data) {
    if (
      !data ||
      !["gemini", "dss"].includes(data.source) ||
      typeof data.answer !== "string" ||
      !Array.isArray(data.suggestions)
    ) {
      throw new Error("The assistant returned an invalid response.");
    }

    const article = addMessage("Dispatch Assistant", data.answer);

    article.prepend(
      node(
        "span",
        data.source === "gemini"
          ? "GEMINI · REVIEW BEFORE APPROVING"
          : "STANDARD DSS · AI UNAVAILABLE",
        "mai-source"
      )
    );

    for (const driver of data.suggestions) {
      const card = node("div", "", "mai-driver-card");

      card.append(
        node(
          "strong",
          driver.driver_code || `Driver ${driver.driver_id}`
        ),
        node("p", driver.reason),
        node(
          "p",
          `Pickup: ${driver.pickup_km ?? "—"} km · ETA: ${driver.eta_minutes ?? "—"} min`,
          "mai-driver-stats"
        ),
        node(
          "p",
          `Active orders: ${driver.active_orders ?? "—"} · DSS score: ${driver.score ?? "—"}`,
          "mai-driver-stats"
        )
      );

      if (driver.is_dss_recommended) {
        card.appendChild(node("small", "Top DSS recommendation"));
      }

      if (driver.currently_assigned) {
        card.appendChild(node("p", "Currently assigned"));
      }

            const orderId = Number(data.order?.id);
      const driverId = Number(driver.driver_id);

      if (
        Number.isSafeInteger(orderId) && orderId > 0 &&
        Number.isSafeInteger(driverId) && driverId > 0
      ) {
        const link = node(
          "a",
          driver.currently_assigned
            ? "View Assignment"
            : "Review Assignment",
          "mai-review"
        );

        const url = new URL(
          "/dispatch.html",
          window.location.origin
        );

        url.searchParams.set("order", String(orderId));
        url.searchParams.set("driver", String(driverId));

        link.href = url.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";

        card.appendChild(link);
      }
      article.appendChild(card);
    }

    const notes = [
      ...(data.uncertainties || []),
      ...(data.warnings || [])
    ];

    if (data.candidate_list_limited) {
      notes.push(
        `Context includes ${data.supplied_candidates} of ${data.total_candidates} candidates.`
      );
    }

    if (notes.length) {
      const list = node("ul", "", "mai-notes");

      for (const note of [...new Set(notes)].slice(0, 12)) {
        list.appendChild(node("li", String(note)));
      }

      article.appendChild(list);
    }

    messages.scrollTop = messages.scrollHeight;
  }

  async function readResponse(response) {
    try {
      return await response.json();
    } catch {
      throw new Error(
        "The server did not return a readable response."
      );
    }
  }

  async function loadOrders() {
    if (sending || loading) return;

    loading = true;
    const previous = order.value;
    controls();
    setStatus("Loading orders...");

    try {
      const sessionResponse = await fetch("/api/auth/me", {
        credentials: "same-origin",
        cache: "no-store"
      });

      const session = await readResponse(sessionResponse);

      if (
        !sessionResponse.ok ||
        session.user?.role !== "manager" ||
        !session.csrf_token
      ) {
        ready = false;
        root.hidden = true;
        return;
      }

      csrf = session.csrf_token;

      const response = await fetch("/api/orders", {
        credentials: "same-origin",
        cache: "no-store"
      });

      const result = await readResponse(response);

      if (!response.ok) {
        throw new Error(result.message || "Unable to load orders.");
      }

      if (!Array.isArray(result.data)) {
        throw new Error("Order data is invalid.");
      }

      orders = result.data;
      order.replaceChildren();

      const general = node(
        "option",
        "General questions (no order)"
      );
      general.value = "";
      order.appendChild(general);

      for (const item of orders) {
        const option = node(
          "option",
          `${item.order_code} · ${item.status}`
        );
        option.value = String(item.id);
        order.appendChild(option);
      }

      const preferred =
        previous ||
        document.getElementById("dispatch-order")?.value ||
        "";

      if (orders.some(item => String(item.id) === preferred)) {
        order.value = preferred;
      }

      ready = true;
      resetChat();
      describeOrder();

      setStatus(
        "Ready. Responses support your decision; they do not assign drivers."
      );
    } catch (error) {
      ready = false;
      setStatus(error.message, true);
    } finally {
      loading = false;
      controls();
    }
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();

    if (!ready || sending || loading || !form.reportValidity()) {
      return;
    }

    const text = question.value.trim();
    if (!text || text.length > 1500) return;

    const orderId = order.value ? Number(order.value) : null;

    const past = history.slice(-6).map(item => ({
      role: item.role,
      text: item.text.slice(0, 1500)
    }));

    sending = true;
    controls();
    addMessage("You", text, true);
    setStatus("Reviewing dispatch data...");

    try {
      const response = await fetch("/api/manager-ai/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrf
        },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          question: text,
          order_id: orderId,
          history: past
        })
      });

      const result = await readResponse(response);

      if (!response.ok) {
        if (result.fallback) showAnswer(result.fallback);

        throw new Error(
          result.message || "Unable to answer. Use the standard DSS."
        );
      }

      showAnswer(result.data);

      if (result.data.source === "gemini") {
        history.push(
          { role: "user", text },
          {
            role: "assistant",
            text: result.data.answer.slice(0, 1500)
          }
        );
        history = history.slice(-6);
      }

      question.value = "";

      setStatus(
        "Reply received. Review the facts before making an assignment."
      );
    } catch (error) {
      setStatus(
        error.name === "TimeoutError" || error.name === "AbortError"
          ? "The request timed out. Standard DSS remains available."
          : error.message,
        true
      );
    } finally {
      sending = false;
      controls();

      if (!get("panel").hidden) question.focus();
    }
  });

  question.addEventListener("input", controls);
  refresh.addEventListener("click", loadOrders);

  clear.addEventListener("click", () => {
    resetChat();
    setStatus("Conversation cleared.");
  });

  order.addEventListener("change", () => {
    resetChat();
    describeOrder();
    setStatus(
      "Order context changed. A new conversation has started."
    );
  });

  controls();
  loadOrders();
})();
