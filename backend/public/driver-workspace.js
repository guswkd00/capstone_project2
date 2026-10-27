(() => {
  "use strict";

  function init() {
    const $ = (id) => document.getElementById(id);

    const node = (tag, text) => {
      const el = document.createElement(tag);
      if (text != null) el.textContent = text;
      return el;
    };

    const money = (value) =>
      `${Number(value || 0).toLocaleString("en-US")} VND`;

    const stamp = (value) =>
      value
        ? new Date(value).toLocaleString("en-GB", {
            timeZone: "Asia/Ho_Chi_Minh",
          })
        : "—";

    let orders = [];
    let profile;
    let walletBusy = false;
    let walletSending = false;
    let requestType;
    let requestKey;
    let requestFingerprint;
    let chatBusy = false;
    let chatSending = false;
    let chatGeneration = 0;
    let chatCursor = null;
    let messageKey;
    let messageFingerprint;

    async function api(url, options = {}) {
      const response = await fetch(url, {
        cache: "no-store",
        ...options,
        signal: AbortSignal.timeout(15000),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message ||
            `Request failed (${response.status}).`
        );
      }

      return result;
    }

    const post = (url, body, method = "POST") =>
      api(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

    function open(id) {
      if (!$(id).open) $(id).showModal();
    }

    for (const name of ["wallet", "chat", "profile"]) {
      $(`close-${name}`).addEventListener("click", () => {
        if (name !== "wallet" || !walletSending) {
          $(`${name}-dialog`).close();
        }
      });

      $(`open-${name}-btn`).addEventListener("click", () => {
        open(`${name}-dialog`);

        if (name === "wallet") loadWallet();
        if (name === "chat") loadMessages();
      });
    }

    $("wallet-dialog").addEventListener("cancel", (event) => {
      if (walletSending) event.preventDefault();
    });

    function profileFields() {
      if (!profile) return;

      $("nav-driver-name").textContent = profile.full_name;

      $("nav-driver-zone").textContent =
        profile.service_zone || "No assigned hub";

      document.querySelector(".avatar").textContent =
        profile.full_name.trim().slice(0, 1);

      const list = node("dl");
      list.className = "df-fields";

      const fields = [
        ["Driver ID", profile.driver_code],
        ["Name", profile.full_name],
        ["Hub", profile.service_zone],
        ["Vehicle", profile.plate_number],
        ["Vehicle type", profile.vehicle_type],
        ["Payload capacity", `${profile.capacity_kg} kg`],
        ["Driver status", profile.status],
        ["Vehicle status", profile.vehicle_status],
      ];

      for (const [label, value] of fields) {
        list.append(
          node("dt", label),
          node("dd", value || "Not assigned")
        );
      }

      $("profile-content").replaceChildren(list);
    }

    document.addEventListener("driver:data", (event) => {
      ({ orders, profile } = event.detail);
      profileFields();

      const selection = $("chat-order-selector");
      const previous = selection.value;

      selection.replaceChildren();

      for (const order of orders) {
        const option = node(
          "option",
          `${order.order_code} · ${order.status}`
        );

        option.value = order.id;
        selection.append(option);
      }

      if (
        orders.some((order) => String(order.id) === previous)
      ) {
        selection.value = previous;
      } else {
        chatGeneration++;
        $("chat-messages").replaceChildren();
      }

      if (!orders.length) {
        $("chat-status").textContent =
          "No assigned deliveries to message about.";
      }
    });

    async function loadWallet() {
      if (walletBusy) return;

      walletBusy = true;

      try {
        const data = await api("/api/driver/wallet");
        const wallet = data.data;

        $("wallet-cash").textContent =
          money(wallet.available_cash);

        $("modal-wallet-cash").textContent =
          money(wallet.available_cash);

        $("wallet-deposit").textContent =
          money(wallet.deposit_balance);

        $("driver-points").textContent = wallet.points;

        $("daily-bonus").textContent =
          money(data.rewards.daily_bonus);

        $("df-active-count").textContent =
          data.metrics.active || 0;

        $("df-completed-count").textContent =
          data.metrics.completed || 0;

        $("df-cod-total").textContent =
          money(data.metrics.cod_to_collect);

        if (document.activeElement !== $("max-distance")) {
          $("max-distance").value = wallet.max_delivery_km;
        }

        $("max-distance").max =
          data.rewards.max_delivery_km;

        const next = data.rewards.tiers.find(
          (tier) => Number(wallet.points) < tier.points
        );

        $("reward-status").textContent =
          `+${data.rewards.points_per_delivery} points per completed delivery. ` +
          (
            next
              ? `${wallet.points}/${next.points} points toward the next tier (${money(next.bonus)}).`
              : "All configured tiers reached."
          );

        const tiers = $("reward-tiers");
        tiers.replaceChildren();

        for (const tier of data.rewards.tiers) {
          const reached =
            Number(wallet.points) >= tier.points;

          const item = node(
            "div",
            `${tier.points} points: ${money(tier.bonus)}` +
              (reached ? " · Reached" : "")
          );

          item.className =
            `milestone-item${reached ? " reached" : ""}`;

          tiers.append(item);
        }

        const rows = $("wallet-tx-list");
        rows.replaceChildren();

        for (const entry of data.entries) {
          const row = node("tr");

          row.append(
            node(
              "td",
              `${entry.description} · ${stamp(entry.created_at)}`
            ),
            node(
              "td",
              `Cash ${money(entry.cash_delta)} · ` +
                `Deposit ${money(entry.deposit_delta)} · ` +
                `Points ${entry.points_delta}`
            )
          );

          rows.append(row);
        }

        for (const request of data.requests) {
          const row = node("tr");

          row.append(
            node(
              "td",
              `${request.request_type} #${request.id} · ` +
                stamp(request.created_at)
            ),
            node(
              "td",
              `${money(request.amount)} · ${request.status}`
            )
          );

          rows.append(row);
        }

        if (!rows.children.length) {
          const row = node("tr");

          row.append(
            node("td", "No transactions or requests yet.")
          );

          rows.append(row);
        }

        $("wallet-action-msg").textContent =
          `${data.note} Reserved for pending withdrawals: ` +
          `${money(wallet.reserved_cash)}.`;
      } catch (error) {
        $("wallet-action-msg").textContent = error.message;

        $("df-message").textContent =
          `Wallet/rewards unavailable: ${error.message} ` +
          "Use Refresh to retry.";
      } finally {
        walletBusy = false;
      }
    }

    document.addEventListener(
      "driver:updated",
      loadWallet
    );

    $("wallet-detail-btn").addEventListener("click", () => {
      open("wallet-dialog");
      loadWallet();
    });

    function request(type) {
      if (walletSending) return;

      requestType = type;
      requestKey = null;
      requestFingerprint = null;

      open("wallet-dialog");

      $("wallet-request-form").hidden = false;
      $("wallet-amount").value = "";
      $("wallet-confirm").checked = false;

      $("wallet-request-description").textContent =
        type === "withdrawal"
          ? "Withdrawal request. Funds are reserved until the Manager confirms an external payment or rejects it."
          : "Deposit request. Your balance changes only after the Manager verifies receipt of the external payment.";

      $("wallet-amount").focus();
    }

    for (const id of [
      "inline-withdraw-btn",
      "btn-withdraw",
    ]) {
      $(id).addEventListener("click", () =>
        request("withdrawal")
      );
    }

    for (const id of [
      "inline-topup-btn",
      "btn-topup",
    ]) {
      $(id).addEventListener("click", () =>
        request("topup")
      );
    }

    $("wallet-request-form").addEventListener(
      "submit",
      async (event) => {
        event.preventDefault();

        if (
          walletSending ||
          !event.target.reportValidity()
        ) {
          return;
        }

        const amount = Number($("wallet-amount").value);
        const fingerprint = `${requestType}:${amount}`;

        if (fingerprint !== requestFingerprint) {
          requestKey = crypto.randomUUID();
          requestFingerprint = fingerprint;
        }

        walletSending = true;

        const controls = [...event.target.elements];
        controls.forEach((el) => {
          el.disabled = true;
        });

        try {
          const result = await post(
            "/api/driver/wallet/requests",
            {
              request_type: requestType,
              amount,
              request_key: requestKey,
            }
          );

          $("wallet-request-form").hidden = true;

          await loadWallet();

          $("wallet-action-msg").textContent =
            result.message;

          requestKey = null;
        } catch (error) {
          $("wallet-action-msg").textContent =
            `${error.message} Retry with the same details ` +
            "to avoid a duplicate request.";
        } finally {
          walletSending = false;

          controls.forEach((el) => {
            el.disabled = false;
          });
        }
      }
    );

    $("distance-form").addEventListener(
      "submit",
      async (event) => {
        event.preventDefault();

        const button =
          event.target.querySelector("button");

        button.disabled = true;

        try {
          const result = await post(
            "/api/driver/preferences",
            {
              max_delivery_km:
                Number($("max-distance").value),
            },
            "PUT"
          );

          $("df-message").textContent = result.message;
        } catch (error) {
          $("df-message").textContent = error.message;
        } finally {
          button.disabled = false;
        }
      }
    );

    function chatRow(message) {
      const row = node("div");
      row.className = `message ${message.sender_role}`;

      row.append(
        node(
          "strong",
          `${message.sender_name} · ` +
            (
              message.sender_role === "manager"
                ? "Manager support"
                : "Driver"
            )
        ),
        node("p", message.message_text),
        node(
          "small",
          `${stamp(message.created_at)} · Saved to system`
        )
      );

      return row;
    }

    async function loadMessages(older = false) {
      const order = $("chat-order-selector").value;

      if (!order || chatBusy || chatSending) return;

      chatBusy = true;

      const generation = chatGeneration;

      $("chat-status").textContent =
        "Loading messages...";

      try {
        const result = await api(
          `/api/driver/orders/${order}/messages` +
            (
              older && chatCursor
                ? `?before=${chatCursor}`
                : ""
            )
        );

        if (generation !== chatGeneration) return;

        const rows = result.data.map(chatRow);

        if (older) {
          $("chat-messages").prepend(...rows);
        } else {
          $("chat-messages").replaceChildren(...rows);
        }

        chatCursor = result.next_cursor;
        $("chat-older").hidden = !chatCursor;

        $("chat-status").textContent =
          result.data.length
            ? result.channel
            : "No messages yet. Manager support channel; external customer messaging is not connected.";

        $("chat-form").querySelector("button").disabled =
          !orders.some(
            (item) =>
              String(item.id) === order &&
              ["assigned", "delivering"].includes(
                item.status
              )
          );
      } catch (error) {
        $("chat-status").textContent =
          `${error.message} Reopen Chat to retry.`;
      } finally {
        chatBusy = false;
      }
    }

    $("chat-order-selector").addEventListener(
      "change",
      () => {
        chatGeneration++;
        chatCursor = null;

        $("chat-messages").replaceChildren();
        loadMessages();
      }
    );

    $("chat-older").addEventListener("click", () =>
      loadMessages(true)
    );

    $("chat-form").addEventListener(
      "submit",
      async (event) => {
        event.preventDefault();

        if (
          chatSending ||
          !event.target.reportValidity()
        ) {
          return;
        }

        const order = $("chat-order-selector").value;
        const text = $("chat-input").value.trim();

        if (!order || !text) return;

        const fingerprint = `${order}:${text}`;

        if (messageFingerprint !== fingerprint) {
          messageKey = crypto.randomUUID();
          messageFingerprint = fingerprint;
        }

        chatSending = true;

        const send =
          event.target.querySelector("button");

        send.disabled = true;
        $("chat-order-selector").disabled = true;

        try {
          await post(
            `/api/driver/orders/${order}/messages`,
            {
              message_text: text,
              message_key: messageKey,
            }
          );

          $("chat-input").value = "";
          messageKey = null;
          messageFingerprint = null;

          chatSending = false;

          await loadMessages();
        } catch (error) {
          $("chat-status").textContent =
            `${error.message} Message is not confirmed saved. ` +
            "Retry with the same text.";
        } finally {
          chatSending = false;
          send.disabled = false;
          $("chat-order-selector").disabled = false;
        }
      }
    );

    document.querySelectorAll("[data-msg]").forEach(
      (button) => {
        button.addEventListener("click", () => {
          $("chat-input").value = button.dataset.msg;
          $("chat-input").focus();
        });
      }
    );

    const poll = setInterval(() => {
      if ($("chat-dialog").open && !chatCursor) {
        loadMessages();
      }
    }, 10000);

    window.addEventListener("pagehide", () => {
      clearInterval(poll);
    });

    $("driver-logout").addEventListener(
      "click",
      async () => {
        $("driver-logout").disabled = true;

        try {
          await post("/api/auth/logout", {});

          window.dispatchEvent(
            new Event("pagehide")
          );

          location.replace("/login.html");
        } catch (error) {
          $("profile-status").textContent =
            error.message;

          $("driver-logout").disabled = false;
        }
      }
    );

    loadWallet();
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
