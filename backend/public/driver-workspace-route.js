(() => {
  "use strict";

  function init() {
    const panel = document.getElementById("route-panel");

    if (!panel) return;

    function node(tag, text = "", className = "") {
      const element = document.createElement(tag);
      element.className = className;
      element.textContent = text;
      return element;
    }

    const money = value =>
      value == null
        ? "Unavailable"
        : `${Number(value).toLocaleString("vi-VN")} ₫`;

    const clock = value =>
      value
        ? new Date(value).toLocaleTimeString("en-GB", {
            timeZone: "Asia/Ho_Chi_Minh",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "Unknown";

    const title = node("h2", "Suggested Stop Order");

    const refresh = node(
      "button",
      "Refresh Suggested Stops"
    );
    refresh.type = "button";

    const message = node("p", "", "route-message");
    message.setAttribute("role", "status");

    const metrics = node("div", "", "route-sum");
    const stops = node("ol");

    const bundle = node("section", "", "advisor-card");
    const prep = node("section", "", "advisor-card");

    panel.replaceChildren(
      title,
      refresh,
      message,
      metrics,
      stops,
      bundle,
      prep
    );

    function stat(container, label, value) {
      const item = node("div", "", "advisor-stat");

      item.append(
        node("small", label),
        node("strong", String(value))
      );

      container.append(item);
    }

    function reset() {
      metrics.replaceChildren();
      stops.replaceChildren();

      bundle.replaceChildren(
        node("h3", "Order Bundling & Profitability Advisor")
      );

      prep.replaceChildren(
        node("h3", "Prep-Time Aware Stop Re-sequencing")
      );
    }

    function render(plan) {
      reset();

      if (!plan.stops.length) {
        message.textContent =
          "No active assigned deliveries. " +
          "Assignments will appear here.";

        bundle.append(
          node(
            "p",
            "At least two assigned orders are needed " +
            "to compare a bundle."
          )
        );

        prep.append(
          node("p", "No pickups to re-sequence.")
        );

        return;
      }

      stat(
        metrics,
        "Route distance",
        `${plan.estimated_total_km} km`
      );

      stat(
        metrics,
        "Travel only",
        `${plan.estimated_travel_minutes} min`
      );

      if (plan.estimated_total_minutes != null) {
        stat(
          metrics,
          "Including wait & service",
          `${plan.estimated_total_minutes} min`
        );
      }

      for (const stop of plan.stops) {
        const item = node("li");

        item.append(
          node(
            "strong",
            `${stop.type === "pickup" ? "Pickup" : "Drop-off"}` +
            ` · ${stop.order_code}`
          ),

          node(
            "p",
            stop.address || "Address not recorded"
          ),

          node(
            "small",
            `${stop.estimated_leg_km} km from previous stop` +
            (
              stop.estimated_arrival_at
                ? ` · ETA ${clock(stop.estimated_arrival_at)}`
                : ""
            )
          )
        );

        if (stop.type === "pickup" && stop.ready_at) {
          item.append(
            node(
              "small",
              `Estimated ready ${clock(stop.ready_at)}` +
              ` · Wait ${stop.estimated_wait_minutes} min`
            )
          );
        }

        if (stop.estimated_late_minutes > 0) {
          item.append(
            node(
              "p",
              `Predicted late: ${stop.estimated_late_minutes} min`,
              "df-error"
            )
          );
        }

        stops.append(item);
      }

      if (
        !plan.bundling ||
        !plan.profitability ||
        !plan.prep_time
      ) {
        bundle.append(
          node(
            "p",
            "Advisor data unavailable. " +
            "Deploy the backend advisor update."
          )
        );

        prep.append(
          node(
            "p",
            "Prep-time data is not available " +
            "from this API version."
          )
        );
      } else {
        const bundling = plan.bundling;
        const profitability = plan.profitability;
        const timing = plan.prep_time;

        bundle.append(
          node(
            "span",
            bundling.status,
            bundling.recommended
              ? "advisor-badge positive"
              : "advisor-badge"
          ),

          node(
            "p",
            `Assigned group: ${bundling.order_codes.join(" + ")}`
          )
        );

        const financialGrid = node(
          "div",
          "",
          "advisor-grid"
        );

        stat(
          financialGrid,
          "Delivery fees",
          money(profitability.delivery_fees)
        );

        stat(
          financialGrid,
          "Modeled vehicle cost",
          money(profitability.estimated_operating_cost)
        );

        stat(
          financialGrid,
          "Estimated operating margin",
          money(profitability.estimated_margin)
        );

        stat(
          financialGrid,
          "Vehicle rate",
          profitability.cost_per_km == null
            ? "Unavailable"
            : `${money(profitability.cost_per_km)}/km`
        );

        stat(
          financialGrid,
          "Distance saved vs sequential",
          `${bundling.distance_saved_km} km`
        );

        stat(
          financialGrid,
          "Time saved vs sequential",
          `${bundling.minutes_saved} min`
        );

        bundle.append(
          financialGrid,

          node(
            "p",
            bundling.comparison,
            "advisor-note"
          ),

          node(
            "p",
            profitability.note,
            "advisor-note"
          ),

          node(
            "p",
            "Advice only. Existing assignments and " +
            "delivery actions are unchanged.",
            "advisor-note"
          )
        );

        prep.append(
          node(
            "span",
            timing.resequenced
              ? "Stop order updated"
              : "Current order retained",
            "advisor-badge"
          )
        );

        const timingGrid = node(
          "div",
          "",
          "advisor-grid"
        );

        stat(
          timingGrid,
          "Nearest-stop waiting",
          `${timing.nearest_wait_minutes} min`
        );

        stat(
          timingGrid,
          "Suggested-route waiting",
          `${timing.optimized_wait_minutes} min`
        );

        stat(
          timingGrid,
          "Time saved vs nearest",
          `${timing.minutes_saved_vs_nearest} min`
        );

        stat(
          timingGrid,
          "Orders predicted late",
          plan.predicted_late_orders
        );

        prep.append(
          timingGrid,

          node(
            "p",
            timing.readiness_source,
            "advisor-note"
          ),

          node(
            "p",
            "Prioritizes fewer late orders, then lateness, " +
            "completion time and distance. Waiting can " +
            "increase when needed to protect deadlines.",
            "advisor-note"
          )
        );
      }

      const assumptions = plan.assumptions;

      if (assumptions) {
        prep.append(
          node(
            "p",
            `Assumptions: ${assumptions.speed_kmh} km/h; ` +
            `road factor ${assumptions.road_factor}; ` +
            `pickup ${assumptions.pickup_service_minutes} min; ` +
            `handover ${assumptions.delivery_service_minutes} min.`,
            "advisor-note"
          )
        );
      }

      for (const warning of plan.warnings || []) {
        prep.append(
          node("p", warning, "advisor-warning")
        );
      }

      message.textContent = [
        plan.position_note,
        plan.estimate_note,
      ].filter(Boolean).join(" ");
    }

    let loading = false;
    let queued = false;

    async function load() {
      if (loading) {
        queued = true;
        return;
      }

      loading = true;
      refresh.disabled = true;

      reset();

      message.textContent =
        "Calculating stops, bundling and prep-time advice…";

      try {
        const response = await fetch(
          "/api/driver/route-plan",
          {
            cache: "no-store",
            signal: AbortSignal.timeout(15000),
          }
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.message ||
            "Unable to load delivery advice."
          );
        }

        render(result.data);

        document.dispatchEvent(
          new CustomEvent("driver:route", {
            detail: result.data,
          })
        );
      } catch (error) {
        reset();

        message.textContent = error.message;

        bundle.append(
          node(
            "p",
            "Bundling advice unavailable. Refresh to retry."
          )
        );

        prep.append(
          node(
            "p",
            "Prep-time advice unavailable. " +
            "Existing delivery controls remain available."
          )
        );
      } finally {
        loading = false;
        refresh.disabled = false;

        if (queued) {
          queued = false;
          load();
        }
      }
    }

    refresh.addEventListener("click", load);

    document.addEventListener("driver:updated", load);

    document.addEventListener(
      "driver:location-updated",
      load
    );

    // Runs after the mobile shell has moved the widgets.
    requestAnimationFrame(() => {
      const content = document.querySelector(
        ".active-sheet-content"
      );

      if (!content) return;

      const shortcut = node(
        "button",
        "View stops & bundles",
        "route-shortcut"
      );

      shortcut.type = "button";

      shortcut.addEventListener("click", () => {
        const sheet = document.querySelector(
          ".order-sheet"
        );

        if (
          sheet &&
          !sheet.classList.contains("expanded")
        ) {
          sheet.querySelector(".sheet-handle")?.click();
        }

        panel.scrollIntoView({
          block: "start",
          behavior: "smooth",
        });
      });

      content.prepend(shortcut);
    });

    load();
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
