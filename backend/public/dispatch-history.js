const historyBody = document.getElementById("history-body");
const historyMessage = document.getElementById("history-message");
const historySearch = document.getElementById("history-search");
const refreshHistory = document.getElementById("refresh-history");

const historyCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0
});

let historyRecords = [];
let loadingHistory = false;

function addCell(row, value, className = "") {
  const cell = document.createElement("td");
  cell.textContent = value;

  if (className) cell.className = className;

  row.appendChild(cell);
  return cell;
}

function renderHistory() {
  const search = historySearch.value.trim().toLowerCase();

  const filtered = historyRecords.filter(record => {
    const searchable = [
      record.order_code,
      record.driver_code,
      record.driver_name,
      record.plate_number,
      record.reason,
      record.decision_type
    ].join(" ").toLowerCase();

    return searchable.includes(search);
  });

  historyBody.replaceChildren();

  for (const record of filtered) {
    const row = document.createElement("tr");

    addCell(row, record.order_code);
    addCell(row, `${record.driver_name} (${record.driver_code})`);
    addCell(row, record.plate_number);

    const decisionCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge";

    if (["recommended", "override"].includes(record.decision_type)) {
      badge.classList.add(record.decision_type);
    }

    badge.textContent = record.decision_type;
    decisionCell.appendChild(badge);
    row.appendChild(decisionCell);

    addCell(row, Number(record.score).toFixed(2));
    addCell(row, `${Number(record.estimated_distance_km).toFixed(2)} km`);
    addCell(row, `${record.estimated_delivery_minutes} min`);
    addCell(row, historyCurrency.format(Number(record.estimated_cost)));
    addCell(row, record.reason, "reason");
    addCell(row, new Date(record.created_at).toLocaleString("en-GB"));

    historyBody.appendChild(row);
  }

  historyMessage.className = "muted";
  historyMessage.textContent = filtered.length
    ? `${filtered.length} decisions found.`
    : "No matching dispatch decisions.";
}

async function loadHistory() {
  if (loadingHistory) return;

  loadingHistory = true;
  refreshHistory.disabled = true;
  historySearch.disabled = true;
  historyMessage.className = "muted";
  historyMessage.textContent = "Loading dispatch history...";
  historyBody.replaceChildren();

  try {
    const response = await fetch("/api/dispatch/history");
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || "Unable to load dispatch history.");
    }

    historyRecords = result.data;
    renderHistory();
  } catch (error) {
    historyRecords = [];
    historyMessage.className = "error";
    historyMessage.textContent = error.message;
  } finally {
    loadingHistory = false;
    refreshHistory.disabled = false;
    historySearch.disabled = false;
  }
}

historySearch.addEventListener("input", renderHistory);
refreshHistory.addEventListener("click", loadHistory);

loadHistory();