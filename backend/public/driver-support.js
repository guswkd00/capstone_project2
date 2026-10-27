(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const node = (tag, text) => {
    const el = document.createElement(tag);
    el.textContent = text;
    return el;
  };

  let selected;
  let cursor;
  let sending = false;
  let reviewing = false;
  let messageKey;
  let fingerprint;
  let generation = 0;

  async function api(path, body) {
    const response = await fetch(
      `/api/driver-support${path}`,
      {
        cache: "no-store",
        signal: AbortSignal.timeout(15000),
        ...(body
          ? {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify(body),
            }
          : {}),
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

  async function refresh() {
    $("refresh").disabled = true;

    try {
      const [requests, orders] = await Promise.all([
        api("/wallet/requests"),
        api("/orders"),
      ]);

      $("requests").replaceChildren();

      for (const request of requests.data) {
        const row = document.createElement("tr");

        const values = [
          request.driver_code,
          `${request.request_type} #${request.id}`,
          `${Number(request.amount).toLocaleString("en-US")} VND`,
          request.status,
        ];

        for (const value of values) {
          row.append(node("td", value));
        }

        const cell = document.createElement("td");

        if (request.status === "pending") {
          const button = node("button", "Review");
          button.type = "button";

          button.addEventListener("click", () => {
            selected = request;

            $("review-form").reset();
            $("review-status").textContent = "";

            $("review-details").textContent =
              `${request.driver_code} · ` +
              `${request.request_type} · ` +
              `${request.amount} VND`;

            $("review").showModal();
          });

          cell.append(button);
        } else {
          cell.textContent =
            request.reference || "Reviewed";
        }

        row.append(cell);
        $("requests").append(row);
      }

      if (!requests.data.length) {
        const row = node("tr", "");
        row.append(node("td", "No wallet requests."));
        $("requests").append(row);
      }

      const previous = $("orders").value;

      $("orders").replaceChildren();

      for (const order of orders.data) {
        const option = node(
          "option",
          `${order.order_code} · ${order.driver_name}`
        );

        option.value = order.id;
        $("orders").append(option);
      }

      if (
        orders.data.some(
          (order) => String(order.id) === previous
        )
      ) {
        $("orders").value = previous;
      }

      $("status").textContent = "Updated.";
    } catch (error) {
      $("status").textContent = error.message;
    } finally {
      $("refresh").disabled = false;
    }
  }

  async function load(older = false) {
    const order = $("orders").value;

    if (!order) return;

    const current = ++generation;

    try {
      const result = await api(
        `/orders/${order}/messages` +
          (
            older && cursor
              ? `?before=${cursor}`
              : ""
          )
      );

      if (current !== generation) return;

      if (!older) {
        $("messages").replaceChildren();
      }

      const rows = result.data.map((message) =>
        node(
          "p",
          `${message.sender_name} ` +
            `(${message.sender_role}) · ` +
            `${new Date(message.created_at).toLocaleString()} — ` +
            message.message_text
        )
      );

      if (older) {
        $("messages").prepend(...rows);
      } else {
        $("messages").append(...rows);
      }

      cursor = result.next_cursor;
      $("older").hidden = !cursor;

      $("status").textContent =
        result.data.length
          ? "Messages saved to system."
          : "No messages yet.";
    } catch (error) {
      $("status").textContent = error.message;
    }
  }

  $("review-form").addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();

      if (
        reviewing ||
        !event.target.reportValidity()
      ) {
        return;
      }

      reviewing = true;

      const controls = [...event.target.elements];

      controls.forEach((el) => {
        el.disabled = true;
      });

      try {
        await api(
          `/wallet/requests/${selected.id}/review`,
          {
            status: $("decision").value,
            reference: $("reference").value,
          }
        );

        $("review").close();
        await refresh();
      } catch (error) {
        $("review-status").textContent =
          error.message;
      } finally {
        reviewing = false;

        controls.forEach((el) => {
          el.disabled = false;
        });
      }
    }
  );

  $("cancel").addEventListener("click", () => {
    if (!reviewing) {
      $("review").close();
    }
  });

  $("review").addEventListener("cancel", (event) => {
    if (reviewing) {
      event.preventDefault();
    }
  });

  $("reply").addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();

      if (sending) return;

      const order = $("orders").value;
      const message = $("text").value.trim();

      if (!order || !message) return;

      const current = `${order}:${message}`;

      if (current !== fingerprint) {
        fingerprint = current;
        messageKey = crypto.randomUUID();
      }

      sending = true;

      $("reply").querySelector("button").disabled = true;
      $("orders").disabled = true;

      try {
        await api(
          `/orders/${order}/messages`,
          {
            message_text: message,
            message_key: messageKey,
          }
        );

        $("text").value = "";
        fingerprint = null;

        await load();
      } catch (error) {
        $("status").textContent = error.message;
      } finally {
        sending = false;

        $("reply").querySelector("button").disabled = false;
        $("orders").disabled = false;
      }
    }
  );

  $("load").addEventListener("click", () => load());

  $("older").addEventListener(
    "click",
    () => load(true)
  );

  $("orders").addEventListener("change", () => {
    cursor = null;
    $("messages").replaceChildren();
    load();
  });

  $("refresh").addEventListener("click", refresh);

  refresh();
})();
