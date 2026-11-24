"use strict";

const { chromium } = require("playwright");
const assert = require("node:assert/strict");

const base =
  process.env.MANAGER_BROWSER_BASE ||
  "http://127.0.0.1:33317";

if (
  !["127.0.0.1", "localhost"].includes(
    new URL(base).hostname
  )
) {
  throw new Error(
    "Use only the disposable local test app."
  );
}

async function main() {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH || undefined,
    headless: true,
  });

  try {
    const manager = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: {
        width: 1440,
        height: 1000,
      },
    });

    const driver = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: {
        width: 390,
        height: 844,
      },
    });

    const errors = [];

    for (const context of [manager, driver]) {
      context.on("page", page => {
        page.on("pageerror", error => {
          errors.push(error.message);
        });
      });
    }

    // Accounts are created by the disposable integration suite.
    for (const [context, email] of [
      [manager, "manager@tests.example"],
      [driver, "driver@tests.example"],
    ]) {
      const response = await context.request.post(
        `${base}/api/auth/login`,
        {
          data: {
            email,
            password: "Disposable-test-password-123",
          },
        }
      );

      assert.equal(response.status(), 200);
    }

    const page = await manager.newPage();

    await page.goto(`${base}/fleet.html`);

    await page.getByText(
      "Zones loaded.",
      { exact: true }
    ).waitFor();

    assert.equal(
      await page.locator(
        ".manager-zone-summary span"
      ).count(),
      13
    );

    const zoneFilter = page.getByRole(
      "combobox",
      {
        name: "Filter drivers by operating zone",
        exact: true,
      }
    );

    await zoneFilter.selectOption("1");

    assert.equal(
      await page.locator(
        ".manager-zone-driver"
      ).count(),
      0
    );

    await zoneFilter.selectOption("2");

    assert.equal(
      await page.locator(
        ".manager-zone-driver"
      ).count(),
      1
    );

    await page.getByRole(
      "combobox",
      {
        name: "Operating zone for TEST-D1",
        exact: true,
      }
    ).selectOption("1");

    await page.getByRole(
      "button",
      {
        name: "Update zone",
        exact: true,
      }
    ).click();

    await page.getByText(
      "Operating zone updated. " +
      "Existing assignments are retained; " +
      "the new zone applies to future recommendations.",
      { exact: true }
    ).waitFor();

    await page.goto(`${base}/dispatch.html`);

    await page.getByRole(
      "button",
      {
        name: "Start live GPS tracking",
        exact: true,
      }
    ).click();

    await page.waitForFunction(() =>
      document.querySelector(
        ".manager-tracking-controls [role=status]"
      )?.textContent.includes("Connected")
    );

    const driverPage = await driver.newPage();

    // Simulate GPS without requesting a real device location.
    await driverPage.addInitScript(() => {
      Object.defineProperty(
        navigator,
        "geolocation",
        {
          value: {
            watchPosition(success) {
              setTimeout(() => {
                success({
                  coords: {
                    latitude: 21.031,
                    longitude: 105.851,
                    accuracy: 8,
                  },
                  timestamp: Date.now(),
                });
              }, 20);

              return 1;
            },

            clearWatch() {},
          },
        }
      );
    });

    await driverPage.goto(`${base}/driver.html`);

    await driverPage.locator(
      "#mobile-gps-toggle"
    ).click();

    await driverPage.waitForFunction(() =>
      document.querySelector(
        "#map-gps-pill"
      )?.textContent === "GPS Active"
    );

    await page.waitForFunction(
      () =>
        document.querySelector(
          ".manager-tracking-controls [role=status]"
        )?.textContent.includes("1 sharing drivers"),
      null,
      { timeout: 10000 }
    );

    const before = await page.evaluate(() => {
      const map = window.getDispatchMap();

      map.setView(
        [21.04, 105.86],
        14,
        { animate: false }
      );

      let tracked;

      map.eachLayer(layer => {
        if (layer instanceof L.CircleMarker) {
          tracked = layer;
        }
      });

      tracked.openPopup();

      return {
        id: tracked._leaflet_id,
        zoom: map.getZoom(),
        center: [
          map.getCenter().lat,
          map.getCenter().lng,
        ],
      };
    });

    // Allow a real four-second polling cycle.
    await page.waitForTimeout(4300);

    const after = await page.evaluate(() => {
      const map = window.getDispatchMap();

      let tracked;

      map.eachLayer(layer => {
        if (layer instanceof L.CircleMarker) {
          tracked = layer;
        }
      });

      return {
        id: tracked._leaflet_id,
        zoom: map.getZoom(),
        center: [
          map.getCenter().lat,
          map.getCenter().lng,
        ],
        open: tracked.isPopupOpen(),
        popup:
          tracked.getPopup()
            .getContent()
            .textContent,
      };
    });

    assert.equal(after.id, before.id);
    assert.equal(after.zoom, before.zoom);
    assert.deepEqual(after.center, before.center);
    assert.equal(after.open, true);

    assert.ok(
      after.popup.includes("TEST-D1")
    );

    // Simulate a connection failure.
    await page.route(
      "**/api/fleet/tracking",
      route => route.abort()
    );

    await page.waitForFunction(
      () =>
        document.querySelector(
          ".manager-tracking-controls [role=status]"
        )?.textContent.includes("Disconnected"),
      null,
      { timeout: 10000 }
    );

    await page.unroute(
      "**/api/fleet/tracking"
    );

    await page.waitForFunction(
      () =>
        document.querySelector(
          ".manager-tracking-controls [role=status]"
        )?.textContent.includes("Connected"),
      null,
      { timeout: 10000 }
    );

    // Stopping Driver GPS must remove the Manager marker.
    await driverPage.locator(
      "#mobile-gps-toggle"
    ).click();

    await page.waitForFunction(
      () =>
        document.querySelector(
          ".manager-tracking-controls [role=status]"
        )?.textContent.includes("0 sharing drivers"),
      null,
      { timeout: 10000 }
    );

    await driverPage.locator(
      "#mobile-wallet-nav"
    ).click();

    assert.equal(
      await driverPage.locator(
        ".wallet-card"
      ).isVisible(),
      true
    );

    await driverPage.locator(
      "#mobile-deliveries-nav"
    ).click();

    await driverPage.locator(
      ".sheet-handle"
    ).click();

    await driverPage.locator(
      ".delivery-tools summary"
    ).click();

    await driverPage.getByRole(
      "button",
      {
        name: "View Delivery Details",
        exact: true,
      }
    ).first().click();

    assert.equal(
      await driverPage.locator(
        "#df-details-dialog"
      ).evaluate(element => element.open),
      true
    );

    await driverPage.locator(
      "#df-close-details"
    ).click();

    await page.goto(
      `${base}/index.html?orders=1`
    );

    await page.locator(
      "#all-button"
    ).click();

    await page.waitForFunction(() =>
      document.body.textContent.includes(
        "test_partner · SOURCE-001"
      )
    );

    assert.deepEqual(errors, []);

    console.log(
      "PASS browser: zone filtering and transfer; " +
      "live polling; stable marker, zoom and popup; " +
      "disconnect and retry; GPS stop removal; " +
      "mobile wallet and delivery details; " +
      "import source labels."
    );
  } finally {
    await browser.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
