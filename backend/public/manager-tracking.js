(() => {
  "use strict";

  // Update keyed markers on the existing Leaflet map.
  window.createManagerTracker = function(
    map,
    status,
    fetcher = fetch
  ) {
    const markers = new Map();

    let pollTimer;
    let expiryTimer;
    let controller;
    let timeout;

    let busy = false;
    let running = false;
    let generation = 0;

    let serverTime = Date.now();
    let receivedAt = performance.now();
    let ttl = 60;

    function text(tag, value) {
      const element = document.createElement(tag);
      element.textContent = value;
      return element;
    }

    function prune(validIds) {
      const estimatedNow =
        serverTime + performance.now() - receivedAt;

      for (const [id, entry] of markers) {
        const removed =
          validIds && !validIds.has(id);

        const expired =
          estimatedNow - entry.updated > ttl * 1000;

        if (removed || expired) {
          map.removeLayer(entry.marker);
          markers.delete(id);
        }
      }
    }

    async function poll() {
      if (!running || busy) return;

      busy = true;

      const epoch = generation;

      const requestController =
        new AbortController();

      controller = requestController;

      const requestTimeout = setTimeout(
        () => requestController.abort(),
        6500
      );

      timeout = requestTimeout;

      try {
        const response = await fetcher(
          "/api/fleet/tracking",
          {
            cache: "no-store",
            signal: requestController.signal,
          }
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.message || "Tracking unavailable."
          );
        }

        if (!running || generation !== epoch) {
          return;
        }

        serverTime = Date.parse(result.server_time);
        receivedAt = performance.now();
        ttl = result.freshness_seconds;

        const ids = new Set();

        for (const driver of result.data) {
          const latitude = Number(driver.latitude);
          const longitude = Number(driver.longitude);

          const updated = Date.parse(
            driver.location_updated_at
          );

          if (
            driver.latitude == null ||
            driver.longitude == null ||
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            Math.abs(latitude) > 90 ||
            Math.abs(longitude) > 180 ||
            !Number.isFinite(updated) ||
            serverTime - updated > ttl * 1000 ||
            updated > serverTime
          ) {
            continue;
          }

          const id = String(driver.id);
          ids.add(id);

          let entry = markers.get(id);

          if (!entry) {
            const marker = L.circleMarker(
              [latitude, longitude],
              {
                radius: 10,
                color: "white",
                weight: 2,
                fillColor: "#00a96b",
                fillOpacity: 1,
              }
            ).addTo(map);

            marker.bindPopup(
              document.createElement("div"),
              {
                autoPan: false,
              }
            );

            entry = {
              marker,
              updated,
            };

            markers.set(id, entry);
          }

          entry.updated = updated;

          entry.marker.setLatLng([
            latitude,
            longitude,
          ]);

          entry.marker.setStyle({
            fillColor:
              driver.operational_state === "Delivering"
                ? "#ee4d2d"
                : "#00a96b",
          });

          const popup = document.createElement("div");

          const updatedText =
            new Date(updated).toLocaleString(
              "en-GB",
              {
                timeZone: "Asia/Ho_Chi_Minh",
              }
            );

          popup.append(
            text(
              "strong",
              `${driver.full_name} · ${driver.driver_code}`
            ),

            text(
              "p",
              `Status: ${driver.operational_state} · ` +
              `On duty: ${driver.on_duty ? "Yes" : "No"}`
            ),

            text(
              "p",
              `Zone: ${driver.service_zone || "Unassigned"}`
            ),

            text(
              "p",
              `GPS updated: ${updatedText} (Vietnam time)`
            ),

            text(
              "p",
              `GPS fresh within ${ttl}s. ` +
              "Availability is independent of GPS."
            )
          );

          entry.marker.getPopup().setContent(popup);
        }

        prune(ids);

        status.textContent =
          `Connected · ${markers.size} sharing drivers · ` +
          `updates every 4s. ${result.definition}`;
      } catch (error) {
        if (running && generation === epoch) {
          prune();

          status.textContent =
            "Disconnected · retrying next cycle. " +
            "Old markers expire automatically.";
        }
      } finally {
        clearTimeout(requestTimeout);

        if (generation === epoch) {
          busy = false;
        }
      }
    }

    return {
      start() {
        if (running) return;

        running = true;
        generation++;
        busy = false;

        poll();

        pollTimer = setInterval(poll, 4000);

        expiryTimer = setInterval(
          () => prune(),
          1000
        );
      },

      stop() {
        running = false;
        generation++;

        controller?.abort();

        clearTimeout(timeout);
        clearInterval(pollTimer);
        clearInterval(expiryTimer);

        for (const entry of markers.values()) {
          map.removeLayer(entry.marker);
        }

        markers.clear();
        busy = false;
      },

      get size() {
        return markers.size;
      },
    };
  };

  function init() {
    const canvas = document.getElementById(
      "dispatch-map"
    );

    if (!canvas) return;

    const controls = document.createElement("div");
    controls.className = "manager-tracking-controls";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = "Start live GPS tracking";
    toggle.setAttribute("aria-pressed", "false");

    const status = document.createElement("p");
    status.setAttribute("role", "status");

    status.textContent =
      "Only sharing drivers with fresh coordinates " +
      "appear in live mode.";

    controls.append(toggle, status);
    canvas.before(controls);

    let tracker;
    let enabled = false;

    toggle.onclick = () => {
      if (!enabled) {
        const map = window.getDispatchMap?.();

        if (!map) {
          status.textContent =
            "Map unavailable. Refresh to retry.";
          return;
        }

        tracker = window.createManagerTracker(
          map,
          status
        );
      }

      enabled = !enabled;

      window.setDispatchLiveMode(enabled);

      if (enabled) {
        tracker.start();
      } else {
        tracker.stop();

        status.textContent =
          "Live tracking stopped. " +
          "Showing dispatch estimates.";
      }

      toggle.textContent = enabled
        ? "Stop live GPS tracking"
        : "Start live GPS tracking";

      toggle.setAttribute(
        "aria-pressed",
        String(enabled)
      );
    };

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!enabled) return;

        if (document.hidden) {
          tracker.stop();
        } else {
          tracker.start();
        }
      }
    );

    window.addEventListener("pagehide", () => {
      tracker?.stop();
    });

    window.addEventListener("pageshow", () => {
      if (enabled && !document.hidden) {
        tracker.start();
      }
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
