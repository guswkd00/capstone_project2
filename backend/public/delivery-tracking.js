(() => {
  const orderSelect = document.getElementById("dispatch-order");
  const refreshButton = document.getElementById("refresh-dispatch");
  const candidates = document.getElementById("candidate-list");

  const controls = document.createElement("div");
  controls.className = "toolbar";

  const startButton = document.createElement("button");
  startButton.type = "button";
  startButton.textContent = "Track Selected Delivery";

  const stopButton = document.createElement("button");
  stopButton.type = "button";
  stopButton.textContent = "Pause Updates";
  stopButton.disabled = true;

  const status = document.createElement("p");
  status.className = "muted";
  status.setAttribute("role", "status");

  controls.append(startButton, stopButton);

  const toolbar = refreshButton.closest(".toolbar");
  toolbar.after(controls, status);

  let timer = null;
  let generation = 0;
  let busy = false;

  function pause(restoreCandidates = false) {
    generation++;
    clearInterval(timer);
    timer = null;

    startButton.disabled = false;
    stopButton.disabled = true;

    if (restoreCandidates) {
      candidates.hidden = false;
    }
  }

  async function refreshTracking(orderId, currentGeneration) {
    if (
      busy ||
      document.hidden ||
      currentGeneration !== generation
    ) return;

    busy = true;

    try {
      const response = await fetch(
        `/api/dispatch/${orderId}/tracking`,
        { cache: "no-store" }
      );

      const result = await response.json();

      if (
        currentGeneration !== generation ||
        orderSelect.value !== orderId
      ) return;

      if (!response.ok) {
        throw new Error(
          result.message || "Unable to refresh tracking."
        );
      }

      if (!result.driver) {
        pause(true);
        status.textContent =
          "This order has no assigned driver. Assign a driver first.";
        return;
      }

      if (typeof window.renderDeliveryTracking !== "function") {
        throw new Error(
          "Tracking renderer is unavailable. Refresh this page."
        );
      }

      candidates.hidden = true;
      window.renderDeliveryTracking(result);

      status.textContent =
        "Tracking updates every 15 seconds while this page is visible. " +
        "The driver must keep GPS sharing enabled.";

      if (
        ["completed", "failed", "cancelled"]
          .includes(result.order.status)
      ) {
        pause();

        status.textContent =
          "This delivery is closed. Automatic updates have stopped.";
      }
    } catch (error) {
      if (currentGeneration !== generation) return;

      status.textContent =
        error.message +
        " Showing the last available view; updates will retry.";
    } finally {
      busy = false;
    }
  }

  startButton.addEventListener("click", () => {
    if (!orderSelect.value || orderSelect.disabled) {
      status.textContent =
        "Wait for the order to finish loading, then try again.";
      return;
    }

    pause();

    const orderId = orderSelect.value;
    const currentGeneration = generation;

    startButton.disabled = true;
    stopButton.disabled = false;

    status.textContent = "Loading assigned driver location…";

    timer = setInterval(() => {
      refreshTracking(orderId, currentGeneration);
    }, 15000);

    refreshTracking(orderId, currentGeneration);
  });

  stopButton.addEventListener("click", () => {
    pause();

    status.textContent =
      "Updates paused. The map shows the last received position.";
  });

  orderSelect.addEventListener("change", () => {
    pause(true);
    status.textContent = "";
  });

  refreshButton.addEventListener("click", () => {
    pause(true);
    status.textContent = "";
  });

  window.addEventListener("pagehide", () => pause());
})();
