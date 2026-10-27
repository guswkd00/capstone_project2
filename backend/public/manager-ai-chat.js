(() => {
  "use strict";

  const root = document.getElementById("manager-ai-widget");
  if (!root || root.dataset.chatReady) return;

  if (!root.querySelector("#mai-recents")) {
    const status = root.querySelector("#mai-status");
    if (status) {
      status.textContent =
        "Assistant files are out of date. Refresh with Ctrl + F5.";
    }
    return;
  }

  root.dataset.chatReady = "true";

  const get = id => document.getElementById(`mai-${id}`);
  const question = get("question");
  const order = get("order");
  const messages = get("messages");
  const recents = get("recents");
  const form = get("form");

  let csrf = "", storageKey = "";
  let ready = false, busy = false, sending = false;
  let active = null, recentRows = [];
  let recentCursor = null, messageCursor = null;
  let uncertain = false;

  const validId = id =>
    typeof id === "string" &&
    /^[1-9][0-9]{0,19}$/.test(id) &&
    BigInt(id) <= 18446744073709551615n;

  function node(tag, text, className = "") {
    const el = document.createElement(tag);
    el.textContent = text;
    el.className = className;
    return el;
  }

  function status(text, error = false) {
    get("status").textContent = text;
    get("status").classList.toggle("mai-error", error);
  }

  function controls() {
    const locked = !ready || busy;

    get("send").disabled =
      locked || uncertain || !question.value.trim();
    get("send").textContent = sending ? "Thinking..." : "Send";

    question.disabled = locked;
    order.disabled = locked || !!active;

    for (const id of [
      "clear", "refresh-orders", "refresh-recents",
      "more-recents", "older-messages"
    ]) {
      get(id).disabled = locked;
    }

    get("delete-chat").disabled = locked || !active;

    recents.querySelectorAll("button").forEach(button => {
      button.disabled = locked;
    });
  }

  async function run(task) {
    if (busy) return;
    busy = true;
    controls();

    try {
      await task();
    } catch (error) {
      status(
        ["TimeoutError", "AbortError"].includes(error.name)
          ? "Request timed out. Reopen this chat from Recents before retrying."
          : error.message,
        true
      );
    } finally {
      busy = false;
      sending = false;
      controls();
    }
  }

  async function request(
    path, method = "GET", body, timeout = 15000
  ) {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
      headers: method === "GET" ? {} : {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf
      },
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body) })
    });

    if ([401, 403].includes(response.status)) {
      ready = false;
      root.hidden = true;
      messages.replaceChildren();
      recents.replaceChildren();
    }

    let result;

    try {
      result = await response.json();
    } catch {
      throw new Error("The server returned an unreadable response.");
    }

    return { response, result };
  }

  async function api(path, method = "GET", body) {
    const { response, result } =
      await request(path, method, body);

    if (!response.ok) {
      throw new Error(
        result.message || "Unable to access conversations."
      );
    }

    return result;
  }

  function remember() {
    try {
      if (active) {
        sessionStorage.setItem(storageKey, active.id);
      } else {
        sessionStorage.removeItem(storageKey);
      }
    } catch {
      // History remains stored on the server.
    }
  }

  function closeMobileSidebar() {
    if (
      matchMedia("(max-width: 700px)").matches &&
      !get("sidebar").hidden
    ) {
      get("sidebar-toggle").click();
    }
  }

  function describeOrder() {
    get("order-info").textContent = order.value
      ? `${order.selectedOptions[0]?.textContent}. Start a new chat to change order context.`
      : "General workflow guidance. Select an order for driver comparisons.";
  }

  function selectOrder(id) {
    const value = id == null ? "" : String(id);

    if (
      value &&
      !Array.from(order.options).some(
        option => option.value === value
      )
    ) {
      const option = node(
        "option", `Order #${value} (saved conversation)`
      );
      option.value = value;
      order.appendChild(option);
    }

    order.value = value;
    describeOrder();
  }

  function bubble(label, text, user = false, target = messages) {
    const el = node(
      "article", "",
      `mai-message ${user ? "mai-user" : "mai-assistant"}`
    );

    el.append(node("strong", label), node("p", text));
    target.appendChild(el);
    return el;
  }

  function renderRecents() {
    recents.replaceChildren();

    for (const item of recentRows) {
      const button = node("button", "", "mai-recent-item");
      button.type = "button";
      button.title = item.title;

      button.setAttribute(
        "aria-current", String(item.id === active?.id)
      );

      const date = new Date(item.updated_at);

      button.append(
        node("span", item.title || "New chat"),
        node(
          "small",
          Number.isNaN(date.getTime())
            ? "Saved conversation"
            : date.toLocaleString()
        )
      );

      button.addEventListener("click", () => {
        run(() => openConversation(item.id));
      });

      recents.appendChild(button);
    }

    get("more-recents").hidden = !recentCursor;
    controls();
  }

  async function loadRecents(more = false) {
    try {
      const query = more && recentCursor
        ? `?${new URLSearchParams(recentCursor)}`
        : "";

      const result = await api(
        `/api/manager-ai/conversations${query}`
      );

      if (
        !Array.isArray(result.data) ||
        result.data.some(item =>
          !validId(item.id) || typeof item.title !== "string"
        )
      ) {
        throw new Error("Invalid conversation list.");
      }

      recentRows = [...new Map(
        [
          ...(more ? recentRows : []),
          ...result.data
        ].map(item => [item.id, item])
      ).values()];

      recentCursor = result.next_cursor;

      const updated = recentRows.find(
        item => item.id === active?.id
      );

      if (updated) {
        active.title = updated.title;
        get("thread-title").textContent = updated.title;
      }

      renderRecents();

      get("recents-status").textContent = recentRows.length
        ? "Select a chat to continue."
        : "No conversations yet.";
    } catch (error) {
      get("recents-status").textContent =
        `${error.message} Use ↻ to retry.`;
    }
  }

  function newChat() {
    active = null;
    uncertain = false;
    messageCursor = null;
    remember();

    messages.replaceChildren();

    bubble(
      "Dispatch Assistant",
      "Ask a workflow question, or select an order to compare drivers."
    );

    get("thread-title").textContent = "New chat";
    get("older-messages").hidden = true;
    question.value = "";

    renderRecents();
    describeOrder();
    closeMobileSidebar();

    status("New chat. Previous conversations remain in Recents.");
  }

  function archiveFragment(rows) {
    if (
      !Array.isArray(rows) ||
      rows.some(turn =>
        typeof turn.question !== "string" ||
        typeof turn.answer !== "string" ||
        !["gemini", "nvidia", "dss", "error"].includes(turn.source)
      )
    ) {
      throw new Error("Invalid saved messages.");
    }

    const fragment = document.createDocumentFragment();

    for (const turn of rows) {
      bubble("You", turn.question, true, fragment);

      const article = bubble(
        "Dispatch Assistant", turn.answer, false, fragment
      );

      article.prepend(node(
        "span",
        turn.source === "gemini"
          ? "SAVED GEMINI ANSWER · MAY BE OUTDATED"
          : turn.source === "dss"
            ? "SAVED DSS FALLBACK"
            : "SAVED ERROR",
        "mai-source"
      ));

      article.appendChild(node(
        "small",
        turn.created_at
          ? new Date(turn.created_at).toLocaleString()
          : "Saved message"
      ));
    }

    return fragment;
  }

  async function openConversation(id) {
    if (!validId(id)) {
      throw new Error("Invalid conversation ID.");
    }

    status("Loading conversation...");

    const result = await api(
      `/api/manager-ai/conversations/${id}/messages`
    );

    if (result.conversation?.id !== id) {
      throw new Error("Invalid conversation data.");
    }

    const fragment = archiveFragment(result.data);

    active = result.conversation;
    uncertain = false;
    messageCursor = result.next_before;
    messages.replaceChildren(fragment);

    if (!result.data.length) {
      bubble(
        "Dispatch Assistant",
        "This conversation has no saved messages yet."
      );
    }

    get("thread-title").textContent = active.title;
    get("older-messages").hidden = !messageCursor;
    question.value = "";

    selectOrder(active.order_id);
    remember();
    renderRecents();
    closeMobileSidebar();

    messages.scrollTop = messages.scrollHeight;

    status(
      "Conversation loaded. Ask a follow-up; dispatch facts will be refreshed."
    );
  }

  async function loadOlder() {
    if (!active || !messageCursor) return;

    const result = await api(
      `/api/manager-ai/conversations/${active.id}/messages?before=${encodeURIComponent(messageCursor)}`
    );

    const height = messages.scrollHeight;

    messages.prepend(archiveFragment(result.data));
    messages.scrollTop += messages.scrollHeight - height;

    messageCursor = result.next_before;
    get("older-messages").hidden = !messageCursor;
  }

  async function loadOrders() {
    const previous = active
      ? active.order_id
      : (order.value || null);

    const result = await api("/api/orders");

    if (!Array.isArray(result.data)) {
      throw new Error("Invalid order data.");
    }

    order.replaceChildren();

    const general = node(
      "option", "General questions (no order)"
    );
    general.value = "";
    order.appendChild(general);

    for (const item of result.data) {
      const option = node(
        "option", `${item.order_code} · ${item.status}`
      );
      option.value = String(item.id);
      order.appendChild(option);
    }

    selectOrder(previous);
  }

  function showAnswer(data) {
    if (
      !data ||
      !["gemini", "nvidia", "dss"].includes(data.source) ||
      typeof data.answer !== "string" ||
      !Array.isArray(data.suggestions)
    ) {
      throw new Error("Invalid assistant response.");
    }

    const article = bubble("Dispatch Assistant", data.answer);

    article.prepend(node(
  "span",
  {
    gemini: "GEMINI · REVIEW BEFORE APPROVING",
    nvidia: "NVIDIA · REVIEW BEFORE APPROVING",
    dss: "STANDARD DSS · AI UNAVAILABLE"
  }[data.source],
  "mai-source"
));

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

        const url = new URL("/dispatch.html", location.origin);
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

  async function sendQuestion() {
    sending = true;
    controls();

    const text = question.value.trim();
    let userBubble;
    let submitted = false;
    let received = false;

    try {
      if (!active) {
        const result = await api(
          "/api/manager-ai/conversations",
          "POST",
          {
            order_id: order.value ? Number(order.value) : null
          }
        );

        if (!validId(result.data?.id)) {
          throw new Error("Invalid new conversation.");
        }

        active = result.data;
        remember();
        get("thread-title").textContent = active.title;

        await loadRecents();
      }

      userBubble = bubble("You", text, true);
      messages.scrollTop = messages.scrollHeight;

      status("Reviewing current dispatch data...");
      submitted = true;

      const { response, result } = await request(
        "/api/manager-ai/chat",
        "POST",
        {
          question: text,
          conversation_id: active.id,
          order_id: active.order_id == null
            ? null : Number(active.order_id)
        },
        55000
      );

      received = true;

      const data = response.ok
        ? result.data
        : result.fallback;

      if (!data) {
        throw new Error(
          result.message || "No answer was returned."
        );
      }

      showAnswer(data);

      const saved =
        data.history_saved === true &&
        data.conversation_id === active.id;

      if (saved) {
        question.value = "";
      } else {
        uncertain = true;
        userBubble.appendChild(node(
          "small", "History save not confirmed."
        ));
      }

      const note = saved
        ? "Saved to history."
        : (
          data.history_error ||
          "History save not confirmed. Reopen this chat from Recents."
        );

      status(
        response.ok
          ? note
          : `${result.message || "AI unavailable."} ${note}`,
        !response.ok || !saved
      );
    } catch (error) {
      if (submitted && !received) uncertain = true;

      if (userBubble) {
        userBubble.appendChild(node(
          "small",
          uncertain
            ? "Delivery/save outcome unknown. Reopen this chat before retrying."
            : "This attempt was not saved."
        ));
      }

      throw error;
    } finally {
      if (active) await loadRecents();
    }
  }

  form.addEventListener("submit", event => {
    event.preventDefault();

    if (
      !ready || busy || uncertain ||
      !form.reportValidity() || !question.value.trim()
    ) {
      return;
    }

    run(sendQuestion);
  });

  question.addEventListener("input", controls);

  get("clear").addEventListener("click", () => {
    if (!busy && ready) newChat();
  });

  get("refresh-recents").addEventListener("click", () => {
    run(() => loadRecents());
  });

  get("more-recents").addEventListener("click", () => {
    run(() => loadRecents(true));
  });

  get("older-messages").addEventListener("click", () => {
    run(loadOlder);
  });

  get("refresh-orders").addEventListener("click", () => {
    run(async () => {
      await loadOrders();
      status("Orders refreshed. Conversation retained.");
    });
  });

  order.addEventListener("change", describeOrder);

  get("delete-chat").addEventListener("click", () => {
    if (
      !active || busy ||
      !confirm("Delete this conversation and all its messages?")
    ) {
      return;
    }

    run(async () => {
      await api(
        `/api/manager-ai/conversations/${active.id}`,
        "DELETE"
      );

      newChat();
      await loadRecents();
      status("Conversation deleted.");
    });
  });

  root.addEventListener("mai:open", () => {
    if (ready && !busy) run(() => loadRecents());
  });

  controls();

  run(async () => {
    const session = await api("/api/auth/me");

    if (
      session.user?.role !== "manager" ||
      !session.csrf_token
    ) {
      root.hidden = true;
      return;
    }

    csrf = session.csrf_token;
    storageKey = `mai-active-${session.user.id}`;

    let savedId;

    try {
      savedId = sessionStorage.getItem(storageKey);
    } catch {
      // Browser storage is optional.
    }

    await loadOrders();
    ready = true;

    newChat();
    await loadRecents();

    if (validId(savedId)) {
      try {
        await openConversation(savedId);
      } catch {
        status(
          "Previous chat unavailable. Choose another from Recents or start a new chat.",
          true
        );
      }
    }
  });
})();
