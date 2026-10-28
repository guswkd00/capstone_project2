(() => {
  "use strict";

  function initialiseRoutePanel() {
    const main = document.querySelector(".df-driver-main");

    if (!main) return;

    function node(tag, value, className = "") {
      const element = document.createElement(tag);

      element.textContent = value;
      element.className = className;

      return element;
    }

    const panel =
      document.getElementById("route-panel") ||
      node("section", "", "df-card");

    panel.style.marginTop = "0";
    panel.style.marginBottom = "0";

    const title = node("h2", "Suggested Stop Order");

    const note = node(
      "p",
      "Refresh after updating delivery progress. " +
        "Suggested stops use stored coordinates, not road navigation.",
      "df-muted route-note"
    );

    const refresh = node(
      "button",
      "Refresh Suggested Stops"
    );

    refresh.type = "button";

    const message = node("p", "", "route-message");
    message.setAttribute("role", "status");

    // Two stat boxes: estimated distance and travel time.
    const summary = node("div", "", "route-sum");
    summary.hidden = true;

    function stat(value, label) {
      const box = node("div", "", "route-stat");

      box.append(
        node("b", value),
        node("small", label)
      );

      return box;
    }

    const stops = document.createElement("ol");

    // Order: title, note, stats, stops, status message, refresh button.
    panel.append(
      title,
      note,
      summary,
      stops,
      message,
      refresh
    );

    let loading = false;

    async function loadRoute() {
      if (loading) return;

      loading = true;
      refresh.disabled = true;

      message.textContent = "Loading suggested stops...";
      summary.replaceChildren();
      summary.hidden = true;
      stops.replaceChildren();

      try {
        const response = await fetch(
          "/api/driver/route-plan",
          {
            cache: "no-store",
          }
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.message ||
              "Unable to load suggested stops."
          );
        }

        const plan = result.data;

        if (!plan.stops.length) {
          message.textContent =
            "No active deliveries to plan.";
          return;
        }

        for (const stop of plan.stops) {
          const item = document.createElement("li");

          item.append(
            node(
              "strong",
              `${
                stop.type === "pickup"
                  ? "Pickup"
                  : "Delivery"
              } — ${stop.order_code}`
            ),
            node(
              "p",
              stop.address || "Address not recorded"
            ),
            node(
              "small",
              "Estimated distance from previous point: " +
                `${Number(
                  stop.estimated_leg_km
                ).toFixed(2)} km`
            )
          );

          stops.appendChild(item);
        }

        summary.append(
          stat(
            `${plan.estimated_total_km} km`,
            "Estimated distance"
          ),
          stat(
            `${plan.estimated_travel_minutes} min`,
            "Travel time (excl. pickup and handover)"
          )
        );

        summary.hidden = false;

        message.textContent =
          `${plan.position_note} ${plan.estimate_note}`;
      } catch (error) {
        message.textContent = error.message;
      } finally {
        loading = false;
        refresh.disabled = false;
      }
    }

    refresh.addEventListener("click", loadRoute);

    document.addEventListener(
      "driver:updated",
      loadRoute
    );

    document.addEventListener(
      "driver:location-updated",
      loadRoute
    );

    loadRoute();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initialiseRoutePanel,
      { once: true }
    );
  } else {
    initialiseRoutePanel();
  }
})();
