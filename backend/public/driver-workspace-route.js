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
      "df-muted"
    );

    const refresh = node(
      "button",
      "Refresh Suggested Stops"
    );

    refresh.type = "button";

    const message = node("p", "");
    message.setAttribute("role", "status");

    const summary = node("p", "");
    const stops = document.createElement("ol");

    panel.append(
      title,
      note,
      refresh,
      message,
      summary,
      stops
    );

    let loading = false;

    async function loadRoute() {
      if (loading) return;

      loading = true;
      refresh.disabled = true;

      message.textContent = "Loading suggested stops...";
      summary.textContent = "";
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

          item.style.marginBottom = "16px";

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

        summary.textContent =
          `Estimated distance: ${plan.estimated_total_km} km. ` +
          `Estimated travel time: ${plan.estimated_travel_minutes} min ` +
          "(excludes pickup and handover time).";

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
