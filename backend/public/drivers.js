(() => {
  "use strict";

  const tableBody = document.getElementById("drivers-body");
  const message = document.getElementById("driver-message");
  const addButton = document.getElementById("add-driver");
  const refreshButton = document.getElementById("refresh-drivers");

  const dialog = document.getElementById("driver-dialog");
  const title = document.getElementById("driver-title");
  const form = document.getElementById("driver-form");
  const errorMessage = document.getElementById("driver-error");

  const closeButton = document.getElementById("close-driver");
  const cancelButton = document.getElementById("cancel-driver");
  const saveButton = document.getElementById("save-driver");

  const field = (name) => form.elements.namedItem(name);

  let drivers = [];
  let vehicles = [];
  let zones = [];
  let editingId = null;

  let loading = false;
  let opening = false;
  let saving = false;

  function node(tag, text, className = "") {
    const item = document.createElement(tag);
    item.textContent = text == null ? "—" : String(text);

    if (className) item.className = className;

    return item;
  }

  async function request(url, options = {}) {
    // auth-client.js adds the authentication and CSRF handling.
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
    });

    const result = await response.json().catch(() => null);

    if (!response.ok || !result) {
      throw new Error(
        result?.message || `Request failed (${response.status}).`
      );
    }

    return result;
  }

  function setMessage(text, isError = false) {
    message.textContent = text;
    message.className = isError ? "error" : "muted";
  }

  function badge(status) {
    const item = node("span", status || "Unknown", "badge");

    if (
      ["available", "offline", "maintenance", "inactive"].includes(status)
    ) {
      item.classList.add(status);
    }

    return item;
  }

  function renderDrivers() {
    tableBody.replaceChildren();

    if (!drivers.length) {
      const row = document.createElement("tr");
      const cell = node("td", "No drivers found.");

      cell.colSpan = 8;
      row.appendChild(cell);
      tableBody.appendChild(row);

      return;
    }

    for (const driver of drivers) {
      const row = document.createElement("tr");

      for (const value of [
        driver.driver_code,
        driver.full_name,
        driver.phone,
        driver.service_zone,
        driver.plate_number,
      ]) {
        row.appendChild(node("td", value));
      }

      const driverStatus = document.createElement("td");
      const vehicleStatus = document.createElement("td");

      driverStatus.appendChild(badge(driver.status));
      vehicleStatus.appendChild(badge(driver.vehicle_status));

      const actions = document.createElement("td");
      const edit = node("button", "Edit");

      edit.type = "button";
      edit.addEventListener("click", () => openForm(driver.id));

      actions.appendChild(edit);
      row.append(driverStatus, vehicleStatus, actions);
      tableBody.appendChild(row);
    }
  }

  async function loadData() {
    if (loading) return false;

    loading = true;
    addButton.disabled = true;
    refreshButton.disabled = true;

    setMessage("Loading drivers...");

    try {
      const results = await Promise.all([
        request("/api/fleet/drivers"),
        request("/api/fleet/vehicles"),
        request("/api/fleet/zones"),
      ]);

      if (results.some((result) => !Array.isArray(result.data))) {
        throw new Error("The server returned an invalid fleet response.");
      }

      [drivers, vehicles, zones] = results.map((result) => result.data);

      renderDrivers();
      setMessage(`${drivers.length} drivers found.`);

      return true;
    } catch (error) {
      setMessage(error.message, true);
      return false;
    } finally {
      loading = false;
      addButton.disabled = false;
      refreshButton.disabled = false;
    }
  }

  function populateZones(selectedId) {
    const select = field("zone_id");

    select.replaceChildren(
      new Option("Select a service zone", "")
    );

    for (const zone of zones) {
      if (Number(zone.active) === 1) {
        select.add(new Option(zone.name, String(zone.id)));
      }
    }

    select.value = selectedId == null ? "" : String(selectedId);
  }

  function populateVehicles(preferredId) {
    const select = field("vehicle_id");
    const selectedId = preferredId ?? select.value;

    const currentDriver = drivers.find(
      (driver) => Number(driver.id) === editingId
    );

    // A vehicle allocated to another driver cannot be selected.
    const occupied = new Set(
      drivers
        .filter(
          (driver) =>
            Number(driver.id) !== editingId &&
            driver.vehicle_id != null
        )
        .map((driver) => Number(driver.vehicle_id))
    );

    select.replaceChildren(
      new Option("Select a vehicle", "")
    );

    for (const vehicle of vehicles) {
      if (occupied.has(Number(vehicle.id))) continue;

      const isCurrent =
        Number(currentDriver?.vehicle_id) === Number(vehicle.id);

      if (
        field("status").value === "available" &&
        vehicle.status !== "available" &&
        !isCurrent
      ) {
        continue;
      }

      select.add(
        new Option(
          `${vehicle.plate_number} — ${vehicle.vehicle_type} — ${vehicle.status}`,
          String(vehicle.id)
        )
      );
    }

    select.value = selectedId == null ? "" : String(selectedId);
  }

  async function openForm(id = null) {
    if (loading || opening || saving || dialog.open) return;

    opening = true;

    try {
      // Refresh allocations before opening an add/edit form.
      if (!(await loadData())) return;

      editingId = id == null ? null : Number(id);

      const driver = drivers.find(
        (item) => Number(item.id) === editingId
      );

      if (editingId != null && !driver) {
        throw new Error(
          "Driver no longer exists. Refresh the list."
        );
      }

      form.reset();
      errorMessage.textContent = "";

      title.textContent = driver ? "Edit Driver" : "Add Driver";
      saveButton.textContent = driver ? "Save Changes" : "Save Driver";

      for (const name of [
        "driver_code",
        "full_name",
        "phone",
        "latitude",
        "longitude",
      ]) {
        field(name).value = driver?.[name] ?? "";
      }

      field("status").value = driver?.status || "available";

      populateZones(driver?.zone_id);
      populateVehicles(driver?.vehicle_id);

      dialog.showModal();
    } catch (error) {
      setMessage(error.message, true);
    } finally {
      opening = false;
    }
  }

  field("status").addEventListener("change", () => {
    errorMessage.textContent = "";
    populateVehicles();
  });

  field("zone_id").addEventListener("change", () => {
    // Use the zone coordinates as initial values for a new driver.
    // Existing driver coordinates remain editable without being reset.
    if (editingId != null) return;

    const zone = zones.find(
      (item) => Number(item.id) === Number(field("zone_id").value)
    );

    if (zone) {
      field("latitude").value = zone.latitude ?? "";
      field("longitude").value = zone.longitude ?? "";
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (saving || !form.reportValidity()) return;

    errorMessage.textContent = "";

    const body = Object.fromEntries(new FormData(form));

    for (const name of ["driver_code", "full_name", "phone"]) {
      body[name] = body[name].trim();

      if (!body[name]) {
        errorMessage.textContent =
          "Driver code, full name and phone are required.";
        return;
      }
    }

    for (const name of [
      "zone_id",
      "vehicle_id",
      "latitude",
      "longitude",
    ]) {
      body[name] = Number(body[name]);
    }

    const vehicle = vehicles.find(
      (item) => Number(item.id) === body.vehicle_id
    );

    if (
      !vehicle ||
      (body.status === "available" && vehicle.status !== "available")
    ) {
      errorMessage.textContent =
        "An available driver must have an available vehicle. " +
        "Select another vehicle or set the driver offline.";
      return;
    }

    saving = true;

    const controls = [
      closeButton,
      ...form.querySelectorAll("input, select, button"),
    ];

    const previousStates = controls.map(
      (control) => control.disabled
    );

    const originalLabel = saveButton.textContent;

    controls.forEach((control) => {
      control.disabled = true;
    });

    saveButton.textContent = "Saving...";

    try {
      const result = await request(
        editingId == null
          ? "/api/fleet/drivers"
          : `/api/fleet/drivers/${editingId}`,
        {
          method: editingId == null ? "POST" : "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        }
      );

      dialog.close();

      if (await loadData()) {
        setMessage(result.message || "Driver saved successfully.");
      }
    } catch (error) {
      errorMessage.textContent = error.message;
    } finally {
      saving = false;

      controls.forEach((control, index) => {
        control.disabled = previousStates[index];
      });

      saveButton.textContent = originalLabel;
    }
  });

  function closeForm() {
    if (!saving) dialog.close();
  }

  closeButton.addEventListener("click", closeForm);
  cancelButton.addEventListener("click", closeForm);

  dialog.addEventListener("cancel", (event) => {
    if (saving) event.preventDefault();
  });

  addButton.addEventListener("click", () => openForm());

  refreshButton.addEventListener("click", () => {
    if (!saving && !opening) loadData();
  });

  loadData();
})();