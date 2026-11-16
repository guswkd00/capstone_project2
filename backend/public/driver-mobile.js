/* Existing modules own API requests and business actions. */
(() => {
  "use strict";

  function init() {
    const $ = id => document.getElementById(id);

    const make = (tag, className = "", text = "") => {
      const element = document.createElement(tag);
      element.className = className;
      element.textContent = text;
      return element;
    };

    const money = value =>
      value == null
        ? "Not recorded"
        : `${Number(value).toLocaleString("vi-VN")} ₫`;

    function point(latitude, longitude) {
      if (
        latitude == null ||
        longitude == null ||
        latitude === "" ||
        longitude === ""
      ) {
        return null;
      }

      const lat = Number(latitude);
      const lng = Number(longitude);

      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        Math.abs(lat) > 90 ||
        Math.abs(lng) > 180
      ) {
        return null;
      }

      return [lat, lng];
    }

    const paths = {
      deliveries:
        '<path d="M3 10 12 3l9 7v10H3zM9 21v-8h6v8"/>',
      wallet:
        '<rect x="3" y="5" width="18" height="15" rx="3"/>' +
        '<path d="M3 9h18m-5 5h5"/>',
      rewards:
        '<path d="m12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z"/>',
      chat:
        '<path d="M21 15a3 3 0 0 1-3 3h-7l-6 4v-4H3V4h18z' +
        'M7 9h10m-10 4h6"/>',
      account:
        '<circle cx="12" cy="8" r="4"/>' +
        '<path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    };

    document.querySelectorAll("[data-icon]").forEach(element => {
      element.innerHTML = `
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.7"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          ${paths[element.dataset.icon] || ""}
        </svg>
      `;
    });

    const main = document.querySelector(".df-driver-main");

    const deliveriesScreen = make(
      "section",
      "mobile-screen deliveries-screen"
    );
    deliveriesScreen.id = "mobile-deliveries-screen";

    const walletScreen = make(
      "section",
      "mobile-screen secondary-screen"
    );
    walletScreen.id = "mobile-wallet-screen";
    walletScreen.hidden = true;

    const rewardScreen = make(
      "section",
      "mobile-screen secondary-screen"
    );
    rewardScreen.id = "mobile-rewards-screen";
    rewardScreen.hidden = true;

    const wallet = document.querySelector(".wallet-card");
    const rewards = document.querySelector(".reward-card");

    walletScreen.append(
      make("p", "eyebrow", "YOUR EARNINGS"),
      wallet,
      document.querySelector(".df-metrics")
    );

    rewardScreen.append(
      make("p", "eyebrow", "EVERY DELIVERY COUNTS"),
      rewards
    );

    const progress = make("progress", "reward-progress");
    progress.id = "mobile-reward-progress";
    progress.max = 100;
    progress.value = 0;
    progress.setAttribute(
      "aria-label",
      "Points toward next reward tier"
    );

    rewards.querySelector(".reward-summary").after(progress);

    const mapStage = make("section", "map-stage");
    mapStage.setAttribute("aria-label", "Delivery map");

    mapStage.innerHTML = `
      <div
        id="driver-live-map"
        aria-label="Interactive delivery map"
      ></div>

      <div class="map-top-label">
        <span class="map-live-dot"></span>
        YOUR DELIVERY AREA
      </div>

      <div class="map-left-controls">
        <div class="map-zoom">
          <button
            type="button"
            id="map-zoom-in"
            aria-label="Zoom in"
          >+</button>

          <span id="map-zoom-level">14</span>

          <button
            type="button"
            id="map-zoom-out"
            aria-label="Zoom out"
          >−</button>
        </div>

        <button
          type="button"
          id="map-refresh-stops"
          aria-label="Refresh Suggested Stops"
          title="Refresh Suggested Stops"
        >↻</button>
      </div>

      <div class="map-right-controls">
        <span id="map-gps-pill" role="status">
          Location sharing is off
        </span>

        <button
          type="button"
          id="map-recenter"
          aria-label="Re-center to Driver GPS"
        >⌖</button>
      </div>

      <p id="map-notice" role="status">
        Map preview · HCMC default location
      </p>
    `;

    const sheet = make("section", "order-sheet");
    sheet.setAttribute(
      "aria-label",
      "Delivery details and suggested stops"
    );

    const handle = make("button", "sheet-handle");
    handle.type = "button";
    handle.setAttribute("aria-label", "Expand delivery sheet");
    handle.setAttribute("aria-expanded", "false");
    handle.innerHTML = "<span></span>";

    handle.addEventListener("click", () => {
      const expanded = sheet.classList.toggle("expanded");

      handle.setAttribute("aria-expanded", String(expanded));
      handle.setAttribute(
        "aria-label",
        expanded
          ? "Collapse delivery sheet"
          : "Expand delivery sheet"
      );
    });

    const summary = make("div", "mobile-order-summary");

    const orderSelect = make("select", "mobile-order-select");
    orderSelect.setAttribute(
      "aria-label",
      "Select delivery to show on map"
    );

    const free = make("div", "free-pick-state");
    free.hidden = true;

    free.append(
      make("span", "free-pick-icon", "⌁"),
      make("h2", "", "Ready for your next delivery"),
      make(
        "p",
        "muted",
        "Deliveries are assigned by your Manager. " +
          "New assignments will appear in Active."
      )
    );

    const activeContent = make(
      "div",
      "active-sheet-content"
    );

    const locationPanel =
      $("share-gps-btn").closest(".card");

    locationPanel.classList.add("gps-detail-panel");

    const route = $("route-panel");

    activeContent.append(orderSelect, summary, route);

    const cta = make(
      "button",
      "mobile-primary-cta",
      "Waiting for deliveries…"
    );
    cta.id = "mobile-delivery-cta";
    cta.type = "button";
    cta.disabled = true;

    const controls = make("details", "delivery-tools");

    controls.append(
      make("summary", "", "All deliveries & preferences"),
      document.querySelector(".toolbar"),
      $("df-count"),
      $("df-deliveries"),
      locationPanel
    );

    const sheetScroll = make("div", "sheet-scroll");

    sheetScroll.append(
      free,
      activeContent,
      $("df-message"),
      controls
    );

    sheet.append(handle, sheetScroll, cta);
    deliveriesScreen.append(mapStage, sheet);

    $("df-greeting").classList.add("sr-only");
    $("df-profile").classList.add("sr-only");

    document.querySelector(".top-grid").remove();

    main.append(
      deliveriesScreen,
      walletScreen,
      rewardScreen
    );

    let screen = "deliveries";
    let tab = "active";
    let orders = [];
    let profile = null;
    let selectedId = null;
    let livePosition = null;
    let gpsAccuracy = null;
    let pointsPerDelivery = null;

    let map;
    let layers;
    let driverMarker;
    let radar;

    let fitKey = "";
    let tileErrors = 0;

    const fallback = [10.7769, 106.7009];

    if (window.L) {
      map = L.map("driver-live-map", {
        zoomControl: false,
        attributionControl: true,
      }).setView(fallback, 14);

      L.tileLayer(
        "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
          maxZoom: 19,
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">' +
            "OpenStreetMap</a>",
        }
      )
        .on("tileerror", () => {
          tileErrors++;

          if (tileErrors > 2) {
            $("map-notice").textContent =
              "Map tiles unavailable · " +
              "delivery details remain available";
          }
        })
        .addTo(map);

      layers = L.layerGroup().addTo(map);

      map.on("zoomend", () => {
        $("map-zoom-level").textContent = map.getZoom();
      });

      $("map-zoom-in").onclick = () => map.zoomIn();
      $("map-zoom-out").onclick = () => map.zoomOut();

      new ResizeObserver(() => {
        requestAnimationFrame(() => paintMap(true));
      }).observe(mapStage);
    } else {
      $("map-notice").textContent =
        "Map unavailable · delivery details remain available";

      [
        "map-zoom-in",
        "map-zoom-out",
        "map-recenter",
      ].forEach(id => {
        $(id).disabled = true;
      });
    }

    function selected() {
      return orders.find(
        order => String(order.id) === String(selectedId)
      );
    }

    function eligibleOrders() {
      const payment =
        document.querySelector("[data-pay].on")?.dataset.pay ||
        "all";

      return orders.filter(order => {
        const active = ["assigned", "delivering"].includes(
          order.status
        );

        const matchesTab =
          tab === "history" ? !active : active;

        const matchesPayment =
          payment === "all" ||
          (
            payment === "cod"
              ? order.payment_method === "cash"
              : order.payment_method === "prepaid"
          );

        return matchesTab && matchesPayment;
      });
    }

    function pin(where, type, title, address) {
      if (!where || !map) return;

      const popup = make("div", "map-popup");

      popup.append(
        make(
          "strong",
          "",
          title || (type === "pickup" ? "Pickup" : "Drop-off")
        ),
        make("p", "", address || "Address not recorded")
      );

      L.marker(where, {
        icon: L.divIcon({
          className: `stop-pin ${type}`,
          html:
            type === "pickup"
              ? "<span>↑</span>"
              : "<span>↓</span>",
          iconSize: [32, 38],
          iconAnchor: [16, 38],
        }),
      })
        .bindPopup(popup)
        .addTo(layers);
    }

    function paintMap(forceFit = false) {
      if (!map) return;

      layers.clearLayers();

      const order = selected();
      const storedPosition = point(
        profile?.latitude,
        profile?.longitude
      );

      const current =
        livePosition || storedPosition || fallback;

      if (driverMarker) map.removeLayer(driverMarker);
      if (radar) map.removeLayer(radar);

      const driverLabel = livePosition
        ? "Driver GPS"
        : storedPosition
          ? "Last stored driver location"
          : "HCMC preview location";

      driverMarker = L.marker(current, {
        icon: L.divIcon({
          className: "driver-gps-marker",
          html: "<span></span>",
          iconSize: [24, 24],
        }),
      })
        .bindTooltip(driverLabel)
        .addTo(map);

      radar = L.circle(current, {
        radius: livePosition
          ? Math.max(20, gpsAccuracy || 350)
          : 350,
        color: "#2385ed",
        weight: 1,
        fillOpacity: 0.08,
      }).addTo(map);

      const pickup = point(
        order?.pickup_latitude,
        order?.pickup_longitude
      );

      const dropoff = point(
        order?.latitude,
        order?.longitude
      );

      pin(
        pickup,
        "pickup",
        order?.restaurant_name,
        order?.pickup_address
      );

      pin(
        dropoff,
        "dropoff",
        order?.customer_name,
        order?.delivery_address
      );

      const coordinates = [
        current,
        ...(order?.picked_up_at
          ? []
          : pickup
            ? [pickup]
            : []),
        ...(dropoff ? [dropoff] : []),
      ];

      if (order && coordinates.length > 1) {
        L.polyline(coordinates, {
          color: "#ee4d2d",
          weight: 4,
          opacity: 0.85,
          dashArray: "7 6",
        }).addTo(layers);
      }

      const key =
        `${order?.id || "none"}:` +
        `${Boolean(order?.picked_up_at)}`;

      if (forceFit || key !== fitKey) {
        map.invalidateSize();
        map.stop();

        map.fitBounds(L.latLngBounds(coordinates), {
          animate: false,
          paddingTopLeft: [52, 72],
          paddingBottomRight: [52, 52],
          maxZoom: 15,
        });

        fitKey = key;
      }

      if (tileErrors <= 2) {
        const positionLabel = livePosition
          ? "Live GPS"
          : storedPosition
            ? "Stored driver position"
            : "HCMC preview";

        $("map-notice").textContent =
          `${positionLabel} · Route is a straight-line estimate`;
      }
    }

    function routeBlock(
      label,
      title,
      address,
      amountLabel,
      amount,
      type
    ) {
      const block = make("div", `order-stop ${type}`);
      const copy = make("div", "stop-copy");

      copy.append(
        make("small", "stop-label", label),
        make("strong", "", title || "Not recorded"),
        make("p", "", address || "Address not recorded")
      );

      const payment = make("div", "stop-payment");

      payment.append(
        make("small", "", amountLabel),
        make("b", "", amount)
      );

      block.append(
        make("span", "route-dot"),
        copy,
        payment
      );

      return block;
    }

    function updateCTA() {
      const order = selected();

      const sharing =
        $("share-gps-btn").disabled &&
        !$("stop-gps-btn").disabled;

      const action = order
        ? document.querySelector(
            `[data-order-id="${Number(order.id)}"] .df-primary`
          )
        : null;

      cta.disabled = !order;

      if (!order) {
        cta.textContent = "No delivery selected";
      } else if (
        !sharing &&
        ["assigned", "delivering"].includes(order.status)
      ) {
        cta.textContent = "Share GPS & continue delivery";
      } else {
        cta.textContent =
          action?.textContent || "View delivery details";
      }
    }

    function paintOrder() {
      const visible = eligibleOrders();

      if (
        !visible.some(
          order => String(order.id) === String(selectedId)
        )
      ) {
        selectedId = visible[0]?.id ?? null;
      }

      orderSelect.replaceChildren();

      for (const order of visible) {
        const option = make(
          "option",
          "",
          `${order.order_code} · ${order.customer_name}`
        );

        option.value = order.id;
        option.selected =
          String(order.id) === String(selectedId);

        orderSelect.append(option);
      }

      orderSelect.hidden = visible.length < 2;

      const order = selected();

      summary.replaceChildren();

      if (!order) {
        summary.append(
          make(
            "h2",
            "",
            tab === "history"
              ? "Your delivery history"
              : "You're ready to go"
          ),
          make(
            "p",
            "muted",
            tab === "history"
              ? "No delivery history yet."
              : "Your next assignment will appear here. " +
                "Keep GPS on while delivering."
          )
        );
      } else {
        const strip = make("div", "order-top-strip");

        strip.append(
          make("span", "delivery-tag", "Delivery"),
          make(
            "span",
            "",
            order.delivery_distance_km == null
              ? "Distance unavailable"
              : `${order.delivery_distance_km} km`
          ),
          make(
            "strong",
            "delivery-fee",
            money(order.delivery_fee)
          )
        );

        if (pointsPerDelivery != null) {
          strip.append(
            make(
              "span",
              "points-tag",
              `+${pointsPerDelivery} pts`
            )
          );
        }

        summary.append(strip);

        const meta = make("div", "order-meta");

        meta.append(make("span", "", order.order_code));

        if (order.estimated_delivery_minutes != null) {
          meta.append(
            make(
              "span",
              "eta-tag",
              `~${order.estimated_delivery_minutes} min`
            )
          );
        } else if (order.due_at) {
          const deadline = new Date(
            order.due_at
          ).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          });

          meta.append(
            make("span", "eta-tag", `Due ${deadline}`)
          );
        }

        summary.append(
          meta,
          routeBlock(
            "PICKUP",
            order.restaurant_name,
            order.pickup_address,
            "Pay",
            order.pickup_pay_amount == null
              ? "Not recorded"
              : money(order.pickup_pay_amount),
            "pickup"
          ),
          routeBlock(
            "DROP-OFF",
            order.customer_name,
            order.delivery_address,
            "Collect (COD)",
            money(order.cod_amount),
            "dropoff"
          ),
          make(
            "p",
            "route-estimate-note",
            "Route preview is estimated; follow local road directions."
          )
        );
      }

      route.hidden = tab !== "active";

      updateCTA();
      paintMap();
    }

    function setScreen(next) {
      screen = next;

      deliveriesScreen.hidden = next !== "deliveries";
      walletScreen.hidden = next !== "wallet";
      rewardScreen.hidden = next !== "rewards";

      document.querySelector(".delivery-tabs").hidden =
        next !== "deliveries";

      document
        .querySelectorAll(".bottom-nav button")
        .forEach(button => {
          if (button.dataset.screen === next) {
            button.setAttribute("aria-current", "page");
          } else {
            button.removeAttribute("aria-current");
          }
        });

      if (next === "deliveries") {
        requestAnimationFrame(() => map?.invalidateSize());
      }
    }

    document.querySelectorAll("[data-screen]").forEach(
      button => {
        button.onclick = () =>
          setScreen(button.dataset.screen);
      }
    );

    $("mobile-account-nav").onclick = () =>
      $("open-profile-btn").click();

    for (const [name, id] of [
      ["chat", "open-chat-btn"],
      ["profile", "mobile-account-nav"],
    ]) {
      const dialog = $(`${name}-dialog`);

      new MutationObserver(() => {
        if (dialog.open) {
          document
            .querySelectorAll(".bottom-nav button")
            .forEach(button =>
              button.removeAttribute("aria-current")
            );

          $(id).setAttribute("aria-current", "page");
        } else {
          setScreen(screen);
        }
      }).observe(dialog, {
        attributes: true,
        attributeFilter: ["open"],
      });
    }

    function switchTab(next) {
      tab = next;

      free.hidden = next !== "free";
      activeContent.hidden = next === "free";
      cta.hidden = next === "free";
      controls.hidden = next === "free";
      controls.open = next === "history";

      sheetScroll.scrollTop = 0;

      for (const [id, value] of [
        ["mobile-free-tab", "free"],
        ["df-active-tab", "active"],
        ["df-history-tab", "history"],
      ]) {
        $(id).setAttribute(
          "aria-selected",
          String(value === next)
        );

        $(id).tabIndex = value === next ? 0 : -1;
      }

      paintOrder();
    }

    $("mobile-free-tab").onclick = () =>
      switchTab("free");

    $("df-active-tab").addEventListener(
      "click",
      () => switchTab("active")
    );

    $("df-history-tab").addEventListener(
      "click",
      () => switchTab("history")
    );

    document.querySelector(".delivery-tabs").addEventListener(
      "keydown",
      event => {
        if (
          !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
            event.key
          )
        ) {
          return;
        }

        const buttons = [
          ...document.querySelectorAll(
            '.delivery-tabs [role="tab"]'
          ),
        ];

        let index = buttons.indexOf(document.activeElement);

        if (event.key === "Home") {
          index = 0;
        } else if (event.key === "End") {
          index = 2;
        } else {
          index =
            (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
        }

        event.preventDefault();
        buttons[index].focus();
        buttons[index].click();
      }
    );

    document.querySelectorAll("[data-pay]").forEach(
      button => button.addEventListener("click", paintOrder)
    );

    document.addEventListener(
      "driver:route",
      () => paintMap()
    );

    orderSelect.onchange = () => {
      selectedId = orderSelect.value;
      paintOrder();
    };

    $("mobile-gps-toggle").onclick = () => {
      const button = $("stop-gps-btn").disabled
        ? $("share-gps-btn")
        : $("stop-gps-btn");

      button.click();
    };

    function syncGPS() {
      const sharing =
        $("share-gps-btn").disabled &&
        !$("stop-gps-btn").disabled;

      const text = $("gps-status-text").textContent;
      const fresh = sharing && text.includes("GPS saved:");

      $("mobile-gps-toggle").setAttribute(
        "aria-pressed",
        String(sharing)
      );

      $("mobile-gps-toggle").setAttribute(
        "aria-label",
        sharing ? "Stop Sharing GPS" : "Share GPS"
      );

      $("mobile-gps-label").textContent =
        sharing ? "Stop Sharing" : "Share GPS";

      $("driver-online-dot").classList.toggle(
        "online",
        profile?.status === "available"
      );

      $("map-gps-pill").textContent = fresh
        ? "GPS Active"
        : sharing
          ? "GPS connecting…"
          : "Location sharing is off";

      $("map-gps-pill").title = text;
      $("map-gps-pill").classList.toggle("live", fresh);

      if (livePosition && !fresh) {
        livePosition = null;
        paintMap();
      }

      if (
        !sharing &&
        /denied|requires HTTPS|Session ended/.test(text)
      ) {
        $("map-notice").textContent =
          `${text.trim()} Showing stored/default location.`;
      }

      updateCTA();
    }

    const gpsObserver = new MutationObserver(syncGPS);

    gpsObserver.observe($("gps-status-text"), {
      childList: true,
      subtree: true,
    });

    gpsObserver.observe($("share-gps-btn"), {
      attributes: true,
      attributeFilter: ["disabled"],
    });

    $("map-recenter").onclick = () => {
      const stored = point(
        profile?.latitude,
        profile?.longitude
      );

      map?.setView(livePosition || stored || fallback, 16);

      if (!livePosition) {
        $("map-notice").textContent = stored
          ? "Centered on last stored position · " +
            "turn on Share GPS for live updates"
          : "HCMC preview · turn on Share GPS to locate yourself";
      }
    };

    const refreshStops = route.querySelector("button");

    $("map-refresh-stops").onclick = () =>
      refreshStops?.click();

    if (refreshStops) {
      new MutationObserver(() => {
        $("map-refresh-stops").disabled =
          refreshStops.disabled;
      }).observe(refreshStops, {
        attributes: true,
        attributeFilter: ["disabled"],
      });
    }

    cta.onclick = () => {
      const order = selected();

      if (!order) return;

      if (
        !$("share-gps-btn").disabled &&
        ["assigned", "delivering"].includes(order.status)
      ) {
        $("share-gps-btn").click();

        // Enabling GPS never advances delivery state.
        return;
      }

      const card = document.querySelector(
        `[data-order-id="${Number(order.id)}"]`
      );

      const action =
        card?.querySelector(".df-primary") ||
        card?.querySelector(".df-actions button");

      action?.click();
    };

    document.addEventListener("driver:data", event => {
      profile = event.detail.profile;
      orders = event.detail.orders;

      $("mobile-driver-code").textContent =
        profile.driver_code || "Driver App";

      paintOrder();
      syncGPS();
    });

    document.addEventListener("driver:updated", () => {
      paintOrder();

      if (tab === "free") {
        switchTab("free");
      }
    });

    document.addEventListener(
      "driver:location-updated",
      event => {
        const coordinates = point(
          event.detail?.latitude,
          event.detail?.longitude
        );

        if (!coordinates) return;

        livePosition = coordinates;
        gpsAccuracy = Number(event.detail.accuracy_m);

        if (profile) {
          profile.latitude = coordinates[0];
          profile.longitude = coordinates[1];
        }

        paintMap();
        syncGPS();
      }
    );

    document.addEventListener("driver:wallet", event => {
      const data = event.detail;

      pointsPerDelivery =
        data.rewards.points_per_delivery;

      const next = data.rewards.tiers.find(
        tier => Number(data.data.points) < tier.points
      );

      progress.max =
        next?.points ||
        data.rewards.tiers.at(-1)?.points ||
        100;

      progress.value = Math.min(
        Number(data.data.points),
        progress.max
      );

      progress.setAttribute(
        "aria-valuetext",
        `${data.data.points} points` +
          (
            next
              ? ` toward ${next.points}`
              : " · all tiers reached"
          )
      );

      paintOrder();
    });

    new MutationObserver(updateCTA).observe(
      $("df-deliveries"),
      {
        childList: true,
        subtree: true,
      }
    );

    deliveriesScreen.setAttribute("role", "tabpanel");

    document
      .querySelectorAll('.delivery-tabs [role="tab"]')
      .forEach(button => {
        button.setAttribute(
          "aria-controls",
          deliveriesScreen.id
        );
      });

    switchTab("active");
    syncGPS();

    window.addEventListener("pagehide", () => {
      gpsObserver.disconnect();
    });
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
