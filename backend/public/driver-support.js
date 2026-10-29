(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const node = (tag, text) => {
    const element = document.createElement(tag);

    if (text != null) {
      element.textContent = text;
    }

    return element;
  };

  const money = value =>
    `${Number(value || 0).toLocaleString("en-US")} VND`;

  const stamp = value =>
    value
      ? new Date(value).toLocaleString()
      : "—";

  const validId = value =>
    /^[1-9]\d*$/.test(String(value || "")) &&
    Number.isSafeInteger(Number(value));

  const initialParams = new URLSearchParams(
    location.search
  );

  let preferredOrder = validId(
    initialParams.get("order")
  )
    ? initialParams.get("order")
    : null;

  let targetMessage = validId(
    initialParams.get("message")
  )
    ? initialParams.get("message")
    : null;

  let selected;
  let cursor = null;

  let sending = false;
  let reviewing = false;
  let loading = false;
  let refreshing = false;

  let messageKey;
  let fingerprint;

  let generation = 0;
  let currentOrder = null;
  let messageRows = [];
  let loadedOlder = false;
  let lastRead = 0;

  async function api(path, body) {
    const response = await fetch(
      `/api/driver-support${path}`,
      {
        cache: "no-store",
        credentials: "same-origin",
        signal: AbortSignal.timeout(15000),

        ...(body
          ? {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
          }
          : {})
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.message || "Request failed."
      );
    }

    return result;
  }

  function replyControls() {
    const closed =
      !currentOrder ||
      [
        "completed",
        "failed",
        "cancelled"
      ].includes(currentOrder.status);

    $("reply").querySelector("button").disabled =
      closed || sending || loading;

    $("text").disabled =
      closed || sending;

    $("orders").disabled = sending;

    $("older").hidden = !cursor;
  }

  function renderDetails(result) {
    const order = result.data;

    const title = node(
      "h3",
      order.order_code
    );

    const list = node("dl");

    const fields = [
      ["Status", order.status],

      [
        "Driver",
        [
          order.driver_code,
          order.driver_name
        ].filter(Boolean).join(" · ")
      ],

      ["Restaurant", order.restaurant_name],
      ["Pickup address", order.pickup_address],
      ["Customer", order.customer_name],
      ["Delivery address", order.delivery_address],
      ["Payment", order.payment_method],
      ["Order total", money(order.total_amount)],
      ["COD", money(order.cod_amount)],
      ["Delivery fee", money(order.delivery_fee)],
      ["Deadline", stamp(order.due_at)]
    ];

    for (const [label, value] of fields) {
      list.append(
        node("dt", label),
        node("dd", value || "—")
      );
    }

    const items = node("ul");

    for (const item of result.items || []) {
      items.appendChild(node(
        "li",
        `${item.quantity} × ${item.item_name} · ${money(item.unit_price)}`
      ));
    }

    $("order-details").replaceChildren(
      title,
      list,
      node("h4", "Order items"),
      items
    );
  }

  function renderMessages() {
    const container = $("messages");

    const nearBottom =
      container.scrollHeight -
      container.scrollTop -
      container.clientHeight < 70;

    const previousHeight =
      container.scrollHeight;

    container.replaceChildren();

    for (const message of messageRows) {
      const row = node("article");

      row.className =
        `support-message ${
          message.sender_role === "manager"
            ? "manager"
            : "driver"
        }`;

      row.dataset.messageId =
        String(message.id);

      row.append(
        node(
          "strong",
          `${message.sender_name} · ${
            message.sender_role === "manager"
              ? "Manager"
              : "Driver"
          }`
        ),
        node("p", message.message_text),
        node("small", stamp(message.created_at))
      );

      if (
        String(message.id) === targetMessage
      ) {
        row.classList.add(
          "support-message-target"
        );
      }

      container.appendChild(row);
    }

    if (!messageRows.length) {
      container.appendChild(
        node("p", "No messages yet.")
      );
    }

    if (
      nearBottom ||
      previousHeight === 0
    ) {
      container.scrollTop =
        container.scrollHeight;
    }
  }

  async function load(
    older = false,
    force = false
  ) {
    const orderId = $("orders").value;

    if (
      !validId(orderId) ||
      (loading && !force) ||
      (sending && !force)
    ) {
      return;
    }

    const token = generation;

    loading = true;
    replyControls();

    try {
      const result = await api(
        `/orders/${orderId}/messages` +
        (
          older && cursor
            ? `?before=${cursor}`
            : ""
        )
      );

      if (
        token !== generation ||
        $("orders").value !== orderId
      ) {
        return;
      }

      const merged = new Map(
        messageRows.map(message => [
          String(message.id),
          message
        ])
      );

      result.data.forEach(message => {
        merged.set(
          String(message.id),
          message
        );
      });

      messageRows = [
        ...merged.values()
      ].sort(
        (a, b) =>
          Number(a.id) - Number(b.id)
      );

      if (older || !loadedOlder) {
        cursor = result.next_cursor;
      }

      if (older) {
        loadedOlder = true;
      }

      if (
        currentOrder &&
        result.order_status
      ) {
        currentOrder.status =
          result.order_status;
      }

      const container = $("messages");
      const previousHeight =
        container.scrollHeight;

      renderMessages();

      if (older) {
        container.scrollTop +=
          container.scrollHeight -
          previousHeight;
      }

      $("status").textContent =
        [
          "completed",
          "failed",
          "cancelled"
        ].includes(currentOrder?.status)
          ? "This delivery is closed. The conversation is read-only."
          : "Messages update automatically while this page is visible.";

      const newest = Math.max(
        0,
        ...result.data.map(
          message => Number(message.id)
        )
      );

      if (
        !older &&
        newest > lastRead &&
        !document.hidden
      ) {
        await api(
          `/orders/${orderId}/messages/read`,
          {
            through_id: String(newest)
          }
        );

        if (token === generation) {
          lastRead = newest;
        }
      }
    } catch (error) {
      if (token === generation) {
        $("status").textContent =
          error.message;
      }
    } finally {
      if (token === generation) {
        loading = false;
        replyControls();
      }
    }
  }

  async function selectOrder() {
    const token = ++generation;
    const orderId = $("orders").value;

    currentOrder = null;
    messageRows = [];
    cursor = null;
    loadedOlder = false;
    lastRead = 0;
    loading = true;

    $("messages").replaceChildren();

    replyControls();

    if (!validId(orderId)) {
      loading = false;

      $("order-details").textContent =
        "No delivery selected.";

      return;
    }

    try {
      const result = await api(
        `/orders/${orderId}`
      );

      if (token !== generation) return;

      currentOrder = result.data;

      renderDetails(result);

      const url = new URL(location.href);

      url.searchParams.set(
        "order",
        orderId
      );

      history.replaceState(
        null,
        "",
        url
      );

      loading = false;

      await load();
    } catch (error) {
      if (token === generation) {
        loading = false;

        $("order-details").textContent =
          error.message;

        $("status").textContent =
          error.message;

        replyControls();
      }
    }
  }

  async function refresh() {
    if (refreshing || sending) return;

    refreshing = true;
    $("refresh").disabled = true;

    try {
      const [requests, orders] =
        await Promise.all([
          api("/wallet/requests"),
          api("/orders")
        ]);

      $("requests").replaceChildren();

      for (const request of requests.data) {
        const row = node("tr");

        const values = [
          request.driver_code,
          `${request.request_type} #${request.id}`,
          money(request.amount),
          request.status
        ];

        for (const value of values) {
          row.appendChild(
            node("td", value)
          );
        }

        const cell = node("td");

        if (request.status === "pending") {
          const button = node(
            "button",
            "Review"
          );

          button.type = "button";

          button.addEventListener(
            "click",
            () => {
              selected = request;

              $("review-form").reset();

              $("review-status").textContent =
                "";

              $("review-details").textContent =
                `${request.driver_code} · ` +
                `${request.request_type} · ` +
                money(request.amount);

              $("review").showModal();
            }
          );

          cell.appendChild(button);
        } else {
          cell.textContent =
            request.reference || "Reviewed";
        }

        row.appendChild(cell);
        $("requests").appendChild(row);
      }

      if (!requests.data.length) {
        const row = node("tr");

        const cell = node(
          "td",
          "No wallet requests."
        );

        cell.colSpan = 5;

        row.appendChild(cell);
        $("requests").appendChild(row);
      }

      const previous =
        preferredOrder ||
        $("orders").value;

      $("orders").replaceChildren();

      for (const order of orders.data) {
        const option = node(
          "option",
          `${order.order_code} · ${order.driver_name}`
        );

        option.value = order.id;

        $("orders").appendChild(option);
      }

      if (
        previous &&
        !orders.data.some(
          order =>
            String(order.id) === previous
        )
      ) {
        // Notifications can reference an order outside the latest 200.
        const result = await api(
          `/orders/${previous}`
        );

        const option = node(
          "option",
          `${result.data.order_code} · ${
            result.data.driver_name || "Unassigned"
          }`
        );

        option.value = previous;

        $("orders").appendChild(option);
      }

      if (previous) {
        $("orders").value = previous;
      }

      preferredOrder = null;

      await selectOrder();
    } catch (error) {
      $("status").textContent =
        error.message;
    } finally {
      refreshing = false;
      $("refresh").disabled = false;
    }
  }

  $("review-form").addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      if (
        reviewing ||
        !event.target.reportValidity()
      ) {
        return;
      }

      reviewing = true;

      const controls = [
        ...event.target.elements
      ];

      controls.forEach(element => {
        element.disabled = true;
      });

      try {
        await api(
          `/wallet/requests/${selected.id}/review`,
          {
            status: $("decision").value,
            reference: $("reference").value
          }
        );

        $("review").close();

        await refresh();
      } catch (error) {
        $("review-status").textContent =
          error.message;
      } finally {
        reviewing = false;

        controls.forEach(element => {
          element.disabled = false;
        });
      }
    }
  );

  $("cancel").addEventListener(
    "click",
    () => {
      if (!reviewing) {
        $("review").close();
      }
    }
  );

  $("review").addEventListener(
    "cancel",
    event => {
      if (reviewing) {
        event.preventDefault();
      }
    }
  );

  $("reply").addEventListener(
    "submit",
    async event => {
      event.preventDefault();

      if (
        sending ||
        !event.target.reportValidity() ||
        !currentOrder ||
        [
          "completed",
          "failed",
          "cancelled"
        ].includes(currentOrder.status)
      ) {
        return;
      }

      const orderId = $("orders").value;
      const text = $("text").value.trim();

      if (!text) return;

      const current =
        `${orderId}:${text}`;

      if (fingerprint !== current) {
        fingerprint = current;
        messageKey = crypto.randomUUID();
      }

      sending = true;
      replyControls();

      try {
        await api(
          `/orders/${orderId}/messages`,
          {
            message_text: text,
            message_key: messageKey
          }
        );

        $("text").value = "";

        fingerprint = null;
        messageKey = null;
        sending = false;

        await load(false, true);
      } catch (error) {
        $("status").textContent =
          `${error.message} ` +
          "Retry with the same text if saving was not confirmed.";
      } finally {
        sending = false;
        replyControls();
      }
    }
  );

  $("load").addEventListener(
    "click",
    () => load()
  );

  $("older").addEventListener(
    "click",
    () => load(true)
  );

  $("orders").addEventListener(
    "change",
    () => {
      targetMessage = null;
      selectOrder();
    }
  );

  $("refresh").addEventListener(
    "click",
    refresh
  );

  let poll;

  function startPolling() {
    clearInterval(poll);

    poll = setInterval(() => {
      if (!document.hidden) {
        load();
      }
    }, 5000);
  }

  document.addEventListener(
    "visibilitychange",
    () => {
      if (!document.hidden) {
        load();
      }
    }
  );

  window.addEventListener(
    "pagehide",
    () => clearInterval(poll)
  );

  window.addEventListener(
    "pageshow",
    event => {
      if (event.persisted) {
        startPolling();
        load();
      }
    }
  );

  replyControls();
  refresh();
  startPolling();
})();
