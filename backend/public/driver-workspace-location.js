(() => {
  "use strict";

  function init() {
    const start = document.getElementById("share-gps-btn");
    const stop = document.getElementById("stop-gps-btn");
    const status = document.getElementById("gps-status-text");

    if (!start || !stop || !status) return;

    let sharingToken = null;
    let watch = null;
    let busy = false;
    let lastSent = 0;
    let generation = 0;
    let controller = null;
    let lastPosition = 0;

    async function stopOnServer(token) {
      if (!token) return;

      try {
        const response = await fetch(
          "/api/driver/location/sharing",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              enabled: false,
              sharing_token: token,
            }),
            keepalive: true,
            signal: AbortSignal.timeout(10000),
          }
        );

        if (!response.ok) {
          throw new Error(
            "Server stop was not confirmed."
          );
        }
      } catch {
        status.textContent =
          "GPS stopped on this device. " +
          "Server stop could not be confirmed; " +
          "the live marker will expire automatically.";
      }
    }

    function end() {
      generation++;

      const token = sharingToken;
      sharingToken = null;

      void stopOnServer(token);

      if (watch !== null) {
        navigator.geolocation.clearWatch(watch);
      }

      watch = null;
      controller?.abort();

      start.disabled = false;
      stop.disabled = true;
    }

    function failure(error) {
      const labels = {
        1:
          "Location permission denied. " +
          "Allow location in your browser settings.",
        2:
          "Position unavailable. " +
          "Waiting for a new GPS reading.",
        3:
          "GPS timed out. " +
          "Waiting for a new reading.",
      };

      status.textContent =
        labels[error.code] ||
        error.message ||
        "GPS is unavailable.";

      if (error.code === 1) {
        end();
      }
    }

    start.addEventListener("click", async () => {
      if (watch !== null) return;

      if (
        !window.isSecureContext ||
        !navigator.geolocation
      ) {
        status.textContent =
          "GPS requires HTTPS and a supported browser.";
        return;
      }

      const session = ++generation;

      start.disabled = true;
      stop.disabled = false;

      status.textContent =
        "Waiting for GPS permission and a current position...";

      try {
        const response = await fetch(
          "/api/driver/location/sharing",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              enabled: true,
            }),
            signal: AbortSignal.timeout(10000),
          }
        );

        const data = await response.json();

        if (
          !response.ok ||
          !/^[a-f0-9]{64}$/.test(
            data.sharing_token || ""
          )
        ) {
          throw new Error(
            data.message || "Unable to enable sharing."
          );
        }

        if (session !== generation) {
          void stopOnServer(data.sharing_token);
          return;
        }

        sharingToken = data.sharing_token;
        lastSent = 0;
      } catch (error) {
        if (session === generation) {
          end();
          status.textContent = error.message;
        }

        return;
      }

      watch = navigator.geolocation.watchPosition(
        async position => {
          if (session !== generation || busy) return;

          if (
            Date.now() - position.timestamp > 60000
          ) {
            status.textContent =
              "GPS reading is stale. " +
              "Waiting for a current position.";
            return;
          }

          lastPosition = position.timestamp;

          if (Date.now() - lastSent < 15000) return;

          busy = true;
          lastSent = Date.now();
          controller = new AbortController();

          const timeout = setTimeout(
            () => controller?.abort(),
            12000
          );

          try {
            const response = await fetch(
              "/api/driver/location",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                signal: controller.signal,
                body: JSON.stringify({
                  latitude: position.coords.latitude,
                  longitude: position.coords.longitude,
                  accuracy_m: position.coords.accuracy,
                  captured_at: position.timestamp,
                  sharing_token: sharingToken,
                }),
              }
            );

            const data = await response.json();

            if (session !== generation) return;

            if (
              response.status === 401 ||
              response.status === 403
            ) {
              end();

              status.textContent =
                "Session ended. Please sign in again.";
              return;
            }

            if (!response.ok) {
              throw new Error(
                data.message || "Unable to save GPS."
              );
            }

            status.textContent =
              "GPS saved: " +
              `${position.coords.latitude.toFixed(5)}, ` +
              `${position.coords.longitude.toFixed(5)} · ` +
              `±${Math.round(position.coords.accuracy)} m · ` +
              new Date(data.updated_at).toLocaleTimeString();

            document.dispatchEvent(
              new CustomEvent(
                "driver:location-updated",
                {
                  detail: {
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    accuracy_m: position.coords.accuracy,
                    captured_at: position.timestamp,
                  },
                }
              )
            );
          } catch (error) {
            if (session === generation) {
              status.textContent =
                `${error.message}. ` +
                "Will retry on the next GPS update.";
            }
          } finally {
            clearTimeout(timeout);
            busy = false;
          }
        },
        failure,
        {
          enableHighAccuracy: true,
          maximumAge: 10000,
          timeout: 15000,
        }
      );
    });

    stop.addEventListener("click", () => {
      end();

      status.textContent =
        "Sharing stopped. The last saved position " +
        "is retained; it is not live GPS.";
    });

    const freshness = setInterval(() => {
      if (
        watch !== null &&
        lastPosition &&
        Date.now() - lastPosition > 60000
      ) {
        status.textContent =
          "GPS position is stale. " +
          "Waiting for a new reading.";
      }
    }, 15000);

    window.addEventListener("pagehide", () => {
      end();
      clearInterval(freshness);
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
