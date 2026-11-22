(() => {
  const body = document.getElementById("maintenance-alerts-body");
  const message = document.getElementById("maintenance-message");
  const refresh = document.getElementById("refresh-maintenance");

  if (!body || !message || !refresh) return;

  let loading = false;

  async function loadAlerts() {
    if (loading) return;

    loading = true;
    refresh.disabled = true;
    message.textContent = "Loading maintenance alerts...";
    body.replaceChildren();

    try {
      const response = await fetch("/api/fleet/maintenance-alerts", {
        cache: "no-store"
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message || "Unable to load maintenance alerts."
        );
      }

      const statusLabels = {
        available: "Available",
        maintenance: "In maintenance",
        inactive: "Inactive"
      };

      for (const vehicle of result.data) {
        const row = document.createElement("tr");

        const values = [
          vehicle.plate_number,
          vehicle.alert,
          vehicle.maintenance_due || "Not recorded",
          statusLabels[vehicle.status] || vehicle.status
        ];

        for (const value of values) {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.appendChild(cell);
        }

        body.appendChild(row);
      }

      message.textContent = result.data.length
        ? `${result.data.length} vehicles require attention.`
        : "No maintenance alerts.";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      loading = false;
      refresh.disabled = false;
    }
  }

  refresh.addEventListener("click", loadAlerts);
  loadAlerts();
})();
