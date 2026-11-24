(() => {
  "use strict";

  function init() {
    const main = document.querySelector("main");

    if (!main) return;

    function node(tag, text = "") {
      const element = document.createElement(tag);
      element.textContent = text;
      return element;
    }

    const section = node("section");
    section.className = "card";
    section.style.margin = "18px 0";

    section.append(
      node("h2", "Operating zones · Hanoi")
    );

    const note = node(
      "p",
      "On duty = driver status available, independent " +
      "of GPS. A zone transfer keeps existing deliveries " +
      "and changes only future recommendations."
    );

    const summary = node("div");
    summary.className = "manager-zone-summary";

    const filter = node("select");
    filter.setAttribute(
      "aria-label",
      "Filter drivers by operating zone"
    );

    const refresh = node(
      "button",
      "Refresh zones & drivers"
    );
    refresh.type = "button";

    const status = node("p");
    status.setAttribute("role", "status");

    const list = node("div");
    list.className = "manager-zone-list";

    section.append(
      note,
      summary,
      filter,
      refresh,
      status,
      list
    );

    main.querySelector("h1")?.insertAdjacentElement(
      "afterend",
      section
    );

    let drivers = [];
    let zones = [];
    let busy = false;

    function paint() {
      list.replaceChildren();

      const visible = drivers.filter(driver => {
        if (!filter.value) return true;

        if (filter.value === "unassigned") {
          return (
            !driver.zone_id ||
            !driver.service_zone
          );
        }

        return (
          String(driver.zone_id) === filter.value
        );
      });

      for (const driver of visible) {
        const row = node("div");
        row.className = "manager-zone-driver";

        row.append(
          node(
            "strong",
            `${driver.driver_code} · ${driver.full_name}`
          ),
          node(
            "span",
            `${driver.service_zone || "Unassigned"}` +
            ` · ${driver.status}`
          )
        );

        const choice = node("select");

        choice.setAttribute(
          "aria-label",
          `Operating zone for ${driver.driver_code}`
        );

        choice.append(
          new Option("Select operating zone", "")
        );

        for (
          const zone of zones.filter(
            item => Number(item.active) === 1
          )
        ) {
          choice.append(
            new Option(zone.name, String(zone.id))
          );
        }

        choice.value =
          driver.zone_id == null
            ? ""
            : String(driver.zone_id);

        const save = node("button", "Update zone");
        save.type = "button";

        save.onclick = async () => {
          if (!choice.value) {
            status.textContent =
              "Select an active zone.";
            return;
          }

          save.disabled = true;

          try {
            const response = await fetch(
              `/api/fleet/drivers/${driver.id}/zone`,
              {
                method: "PUT",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  zone_id: Number(choice.value),
                }),
              }
            );

            const data = await response.json();

            if (!response.ok) {
              throw new Error(
                data.message || "Zone transfer failed."
              );
            }

            await load();

            status.textContent = data.message;

            document.getElementById(
              "refresh-fleet"
            )?.click();

            document.getElementById(
              "refresh-dispatch"
            )?.click();
          } catch (error) {
            status.textContent = error.message;
          } finally {
            save.disabled = false;
          }
        };

        row.append(choice, save);
        list.append(row);
      }

      if (!visible.length) {
        list.append(
          node("p", "No drivers in this filter.")
        );
      }
    }

    async function load() {
      if (busy) return;

      busy = true;
      refresh.disabled = true;

      try {
        const responses = await Promise.all([
          fetch("/api/fleet/zone-summary", {
            cache: "no-store",
          }),
          fetch("/api/fleet/drivers", {
            cache: "no-store",
          }),
        ]);

        const [zoneData, driverData] =
          await Promise.all(
            responses.map(response => response.json())
          );

        if (
          responses.some(response => !response.ok)
        ) {
          throw new Error(
            zoneData.message ||
            driverData.message ||
            "Unable to load zones."
          );
        }

        zones = zoneData.data;
        drivers = driverData.data;

        const selected = filter.value;

        filter.replaceChildren(
          new Option("All operating zones", ""),
          new Option(
            "Unassigned drivers",
            "unassigned"
          )
        );

        for (const zone of zones) {
          filter.append(
            new Option(zone.name, String(zone.id))
          );
        }

        filter.value = selected;

        summary.replaceChildren();

        for (const zone of zones) {
          summary.append(
            node(
              "span",
              `${zone.name}: ` +
              `${zone.on_duty_drivers} on duty / ` +
              `${zone.total_drivers} total`
            )
          );
        }

        note.textContent =
          `${zoneData.definition} ` +
          `Unassigned drivers: ${zoneData.unassigned_drivers}.`;

        status.textContent = "Zones loaded.";

        paint();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        busy = false;
        refresh.disabled = false;
      }
    }

    filter.onchange = paint;
    refresh.onclick = load;

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
