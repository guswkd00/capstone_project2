(() => {
  const vehicleSelect = document.getElementById("expense-vehicle");
  const form = document.getElementById("expense-form");
  const message = document.getElementById("expense-message");
  const history = document.getElementById("expense-history");
  const saveButton = document.getElementById("save-expense");

  if (!vehicleSelect || !form) return;

  let historyRequest = 0;
  let saving = false;

  const money = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  });

  async function request(url, options = {}) {
    const response = await fetch(url, options);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "The request failed.");
    }

    return result;
  }

  async function loadHistory() {
    const currentRequest = ++historyRequest;
    const vehicleId = vehicleSelect.value;

    history.replaceChildren();

    if (!vehicleId) {
      message.textContent = "Select a vehicle to view expenses.";
      return;
    }

    message.textContent = "Loading expense history...";

    try {
      const result = await request(
        `/api/fleet/vehicles/${encodeURIComponent(vehicleId)}/expenses`
      );

      if (currentRequest !== historyRequest) return;

      const labels = {
        fuel: "Fuel",
        maintenance: "Maintenance",
        other: "Other"
      };

      for (const expense of result.data) {
        const row = document.createElement("tr");

        const values = [
          expense.expense_date,
          labels[expense.expense_type] || expense.expense_type,
          money.format(Number(expense.amount)),
          expense.description,
          expense.recorded_by
        ];

        for (const value of values) {
          const cell = document.createElement("td");
          cell.textContent = value ?? "";
          row.appendChild(cell);
        }

        history.appendChild(row);
      }

      message.textContent = result.data.length
        ? `${result.data.length} expense records shown.`
        : "No expenses recorded for this vehicle.";
    } catch (error) {
      if (currentRequest === historyRequest) {
        message.textContent = error.message;
      }
    }
  }

  function updateSaveButton() {
    saveButton.disabled = saving || !vehicleSelect.value;
  }

  vehicleSelect.addEventListener("change", updateSaveButton);

  form.addEventListener("submit", async event => {
    event.preventDefault();

    if (saving || !form.reportValidity()) return;

    const vehicleId = vehicleSelect.value;

    if (!vehicleId) {
      message.textContent = "Select a vehicle first.";
      return;
    }

    const values = Object.fromEntries(new FormData(form));

    const body = {
      expense_type: values.expense_type,
      amount: Number(values.amount),
      expense_date: values.expense_date,
      description: String(values.description || "").trim()
    };

    if (
      !Number.isSafeInteger(body.amount) ||
      body.amount <= 0 ||
      body.amount > 9999999999 ||
      !body.description
    ) {
      message.textContent =
        "Enter a valid whole-VND amount and description.";
      return;
    }

    saving = true;
    historyRequest++;

    const controls = [
      vehicleSelect,
      ...Array.from(form.elements)
    ];

    controls.forEach(control => {
      control.disabled = true;
    });

    saveButton.textContent = "Saving...";
    message.textContent = "Saving vehicle expense...";

    try {
      await request(
        `/api/fleet/vehicles/${encodeURIComponent(vehicleId)}/expenses`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }
      );

      form.reset();
      form.elements.namedItem("expense_date").value =
        body.expense_date;

      await loadHistory();

      message.textContent =
        `Expense saved successfully. ${message.textContent}`;
    } catch (error) {
      message.textContent = error.message;
    } finally {
      saving = false;

      controls.forEach(control => {
        control.disabled = false;
      });

      saveButton.textContent = "Save Expense";
      updateSaveButton();
    }
  });

  vehicleSelect.addEventListener("change", loadHistory);

  async function initialiseExpenses() {
    saveButton.disabled = true;
    message.textContent = "Loading vehicles...";

    try {
      const result = await request("/api/fleet/vehicles");
      vehicleSelect.replaceChildren();

      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select a vehicle";
      vehicleSelect.appendChild(placeholder);

      for (const vehicle of result.data) {
        const option = document.createElement("option");
        option.value = vehicle.id;
        option.textContent = vehicle.plate_number;
        vehicleSelect.appendChild(option);
      }

      vehicleSelect.disabled = false;
      message.textContent = "Select a vehicle to view expenses.";
    } catch (error) {
      message.textContent = error.message;
    }
  }

  initialiseExpenses();
})();
