(() => {
  "use strict";

  function init() {
    const get = id => document.getElementById(id);

    const chatButton = get("open-chat-btn");
    const chatDialog = get("chat-dialog");
    const orderSelect = get("chat-order-selector");
    const messages = get("chat-messages");
    const status = get("chat-status");
    const olderButton = get("chat-older");

    if (
      !chatButton ||
      !chatDialog ||
      !orderSelect ||
      !messages ||
      !status
    ) {
      return;
    }

    if (chatButton.dataset.updatesReady) return;

    chatButton.dataset.updatesReady = "true";

    const badge = document.createElement("span");

    badge.className = "driver-chat-unread-badge";
    badge.hidden = true;

    badge.style.cssText = [
      "display:inline-grid",
      "place-items:center",
      "min-width:20px",
      "height:20px",
      "margin-left:6px",
      "padding:0 5px",
      "border-radius:999px",
      "background:#ee4d2d",
      "color:#fff",
      "font-size:11px",
      "font-weight:700",
      "line-height:1"
    ].join(";");

    chatButton.appendChild(badge);

    const latestButton = document.createElement(
      "button"
    );

    latestButton.type = "button";
    latestButton.textContent = "Latest messages";
    latestButton.hidden = true;

    if (olderButton) {
      olderButton.insertAdjacentElement(
        "afterend",
        latestButton
      );
    } else {
      messages.insertAdjacentElement(
        "beforebegin",
        latestButton
      );
    }

    let csrf = "";
    let busy = false;
    let stopped = false;
    let browsingOlder = false;
    let timer = null;
    let generation = 0;
    let unreadOrders = [];

    const acknowledged = new Map();

    function validId(value) {
      return /^[1-9]\d*$/.test(
        String(value || "")
      ) && Number.isSafeInteger(Number(value));
    }

    function node(tag, text) {
      const element = document.createElement(tag);

      if (text != null) {
        element.textContent = String(text);
      }

      return element;
    }

    async function request(path, body) {
      const response = await fetch(path, {
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(15000),

        ...(body === undefined
          ? {}
          : {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrf
            },
            body: JSON.stringify(body)
          })
      });

      if ([401, 403].includes(response.status)) {
        stopped = true;
        clearInterval(timer);

        throw new Error(
          "Your session expired. Refresh the page or sign in again."
        );
      }

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message ||
          "Chat updates are unavailable."
        );
      }

      return result;
    }

    function updateBadge(result) {
      if (
        !Array.isArray(result.data) ||
        !Number.isSafeInteger(result.unread_count) ||
        result.unread_count < 0
      ) {
        throw new Error(
          "Invalid unread message response."
        );
      }

      unreadOrders = result.data;

      const count = result.unread_count;

      badge.textContent = count > 99
        ? "99+"
        : String(count);

      badge.hidden = count === 0;

      badge.style.display = count === 0
        ? "none"
        : "inline-grid";

      chatButton.setAttribute(
        "aria-label",
        count
          ? `Chat, ${count} unread Manager replies`
          : "Chat"
      );

      chatButton.title = count
        ? `${count} unread Manager replies`
        : "Chat with Manager support";

      for (const option of orderSelect.options) {
        const original = option.textContent.replace(
          / · \d+ unread$/,
          ""
        );

        const unread = unreadOrders.find(
          item =>
            String(item.order_id) === option.value
        );

        option.textContent =
          original +
          (
            unread?.unread_count
              ? ` · ${unread.unread_count} unread`
              : ""
          );
      }
    }

    function renderMessages(rows) {
      const nearBottom =
        messages.scrollHeight -
        messages.scrollTop -
        messages.clientHeight < 70;

      const fragment =
        document.createDocumentFragment();

      for (const message of rows) {
        const row = node("div");

        row.className =
          `message ${
            message.sender_role === "manager"
              ? "manager"
              : "driver"
          }`;

        row.dataset.messageId =
          String(message.id);

        const sender =
          message.sender_role === "manager"
            ? "Manager support"
            : "Driver";

        const date = new Date(
          message.created_at
        );

        const timestamp = Number.isNaN(
          date.getTime()
        )
          ? "Saved message"
          : date.toLocaleString();

        row.append(
          node(
            "strong",
            `${message.sender_name} · ${sender}`
          ),
          node("p", message.message_text),
          node(
            "small",
            `${timestamp} · Saved to system`
          )
        );

        fragment.appendChild(row);
      }

      if (!rows.length) {
        fragment.appendChild(
          node("p", "No messages yet.")
        );
      }

      messages.replaceChildren(fragment);

      if (nearBottom) {
        messages.scrollTop =
          messages.scrollHeight;
      }
    }

    async function synchronize() {
      if (
        busy ||
        stopped ||
        document.hidden ||
        !csrf
      ) {
        return;
      }

      busy = true;

      const token = generation;
      const orderId = orderSelect.value;

      try {
        updateBadge(
          await request(
            "/api/driver/messages/unread"
          )
        );

        if (
          !chatDialog.open ||
          browsingOlder ||
          !validId(orderId)
        ) {
          return;
        }

        const result = await request(
          `/api/driver/orders/${orderId}/messages`
        );

        if (
          token !== generation ||
          orderSelect.value !== orderId ||
          !chatDialog.open ||
          browsingOlder
        ) {
          return;
        }

        if (
          !Array.isArray(result.data) ||
          result.data.some(message =>
            !validId(message.id) ||
            typeof message.message_text !== "string" ||
            !["driver", "manager"].includes(
              message.sender_role
            )
          )
        ) {
          throw new Error(
            "Invalid conversation response."
          );
        }

        renderMessages(result.data);

        if (olderButton) {
          olderButton.hidden =
            !result.next_cursor;
        }

        const closed = [
          "completed",
          "failed",
          "cancelled"
        ].includes(result.order_status);

        const sendButton = get(
          "chat-form"
        )?.querySelector("button");

        if (closed && sendButton) {
          sendButton.disabled = true;
        }

        status.textContent = closed
          ? "This delivery is closed. The conversation is read-only."
          : "Manager support. Messages update automatically.";

        const newest = Math.max(
          0,
          ...result.data.map(
            message => Number(message.id)
          )
        );

        if (
          newest > (
            acknowledged.get(orderId) || 0
          ) &&
          !document.hidden
        ) {
          await request(
            `/api/driver/orders/${orderId}/messages/read`,
            {
              through_id: String(newest)
            }
          );

          acknowledged.set(
            orderId,
            newest
          );

          updateBadge(
            await request(
              "/api/driver/messages/unread"
            )
          );
        }
      } catch (error) {
        chatButton.title =
          `Chat updates unavailable: ${error.message}`;

        if (chatDialog.open) {
          status.textContent = error.message;
        }
      } finally {
        busy = false;

        if (
          token !== generation &&
          !stopped
        ) {
          synchronize();
        }
      }
    }

    chatButton.addEventListener(
      "click",
      () => {
        generation++;
        browsingOlder = false;
        latestButton.hidden = true;

        const unread = unreadOrders.find(item =>
          [...orderSelect.options].some(
            option =>
              option.value ===
              String(item.order_id)
          )
        );

        if (
          unread &&
          orderSelect.value !==
            String(unread.order_id)
        ) {
          orderSelect.value =
            String(unread.order_id);

          orderSelect.dispatchEvent(
            new Event("change")
          );
        }

        setTimeout(synchronize, 100);
      }
    );

    orderSelect.addEventListener(
      "change",
      () => {
        generation++;
        browsingOlder = false;
        latestButton.hidden = true;

        setTimeout(synchronize, 100);
      }
    );

    olderButton?.addEventListener(
      "click",
      () => {
        browsingOlder = true;
        latestButton.hidden = false;
      }
    );

    latestButton.addEventListener(
      "click",
      () => {
        generation++;
        browsingOlder = false;
        latestButton.hidden = true;

        synchronize();
      }
    );

    document.addEventListener(
      "driver:data",
      () => synchronize()
    );

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) {
          synchronize();
        }
      }
    );

    function startPolling() {
      clearInterval(timer);

      if (stopped || !csrf) return;

      synchronize();

      timer = setInterval(
        synchronize,
        5000
      );
    }

    window.addEventListener(
      "pagehide",
      () => clearInterval(timer)
    );

    window.addEventListener(
      "pageshow",
      event => {
        if (event.persisted) {
          startPolling();
        }
      }
    );

    async function start() {
      try {
        const result = await request(
          "/api/auth/me"
        );

        if (
          result.user?.role !== "driver" ||
          !result.csrf_token
        ) {
          return;
        }

        csrf = result.csrf_token;

        startPolling();
      } catch (error) {
        chatButton.title = error.message;
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
