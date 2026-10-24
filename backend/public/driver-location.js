(() => {
  const profile =
    document.getElementById("df-profile") ||
    document.getElementById("driver-profile");

  if (!profile) return;

  const box = document.createElement("section");
  box.className = "card";
  box.style.margin = "20px 0";

  box.innerHTML = `
    <h2>Delivery Location</h2>
    <p>
      Share your GPS while delivering.
      Keep this page open to continue updating your location.
    </p>
    <button type="button" id="start-gps">Share GPS</button>
    <button type="button" id="stop-gps" disabled>
      Stop Sharing
    </button>
    <p id="gps-status" role="status">
      Location sharing is off.
    </p>
  `;

  profile.after(box);

  const startButton = box.querySelector("#start-gps");
  const stopButton = box.querySelector("#stop-gps");
  const status = box.querySelector("#gps-status");

  let timer = null;
  let busy = false;
  let generation = 0;

  function stopSharing() {
    generation++;
    clearInterval(timer);
    timer = null;
    startButton.disabled = false;
    stopButton.disabled = true;
  }

  async function updateLocation(currentGeneration) {
    if (busy || currentGeneration !== generation) return;

    busy = true;

    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          {
            enableHighAccuracy: true,
            maximumAge: 10000,
            timeout: 15000
          }
        );
      });

      if (currentGeneration !== generation) return;

      const response = await fetch("/api/driver/location", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy_m: position.coords.accuracy
        })
      });

      const result = await response.json();

      if (currentGeneration !== generation) return;

      if (!response.ok) {
        throw new Error(result.message || "Unable to share GPS.");
      }

      const time = new Date(result.updated_at)
        .toLocaleTimeString("en-GB");

      status.textContent =
        `GPS updated at ${time}. ` +
        `Accuracy: ±${Math.round(position.coords.accuracy)} m.`;
    } catch (error) {
      if (currentGeneration !== generation) return;

      if (error.code === 1) {
        stopSharing();

        status.textContent =
          "Location permission denied. Allow location in " +
          "your browser site settings, then try again.";
      } else {
        status.textContent =
          (error.message || "GPS is temporarily unavailable.") +
          " Keep this page open; the next update will retry.";
      }
    } finally {
      busy = false;
    }
  }

  startButton.addEventListener("click", () => {
    if (timer !== null) return;

    if (!window.isSecureContext || !navigator.geolocation) {
      status.textContent =
        "GPS requires HTTPS and browser location support.";
      return;
    }

    const currentGeneration = ++generation;

    startButton.disabled = true;
    stopButton.disabled = false;

    status.textContent =
      "Waiting for GPS. Please allow browser location access.";

    timer = setInterval(() => {
      updateLocation(currentGeneration);
    }, 15000);

    updateLocation(currentGeneration);
  });

  stopButton.addEventListener("click", () => {
    stopSharing();

    status.textContent =
      "Sharing stopped. The last saved position is retained.";
  });

  window.addEventListener("pagehide", stopSharing);
})();
