window.sfManagerShellReady = (async () => {
  "use strict";

  if (document.getElementById("sf-manager-header")) return true;

  try {
    let session;

if (window.sfSessionReady) {
  session = await window.sfSessionReady;
} else {
  const response = await fetch("/api/auth/me", {
    cache: "no-store"
  });

  if (!response.ok) return false;

  session = await response.json();
}

if (!session || session.user.role !== "manager") {
  return false;
}

    document.body.classList.add(
      "sf-app",
      "sf-manager-layout"
    );

    // Load the assistant after verifying a Manager session.
    (async () => {
      if (window.sfManagerAILoading) return;

      window.sfManagerAILoading = true;

      function loadAIAsset(tag, url) {
        return new Promise((resolve, reject) => {
          const asset = document.createElement(tag);

          if (tag === "link") {
            asset.rel = "stylesheet";
            asset.href = url;
          } else {
            asset.src = url;
          }

          asset.onload = resolve;

          asset.onerror = () => reject(
            new Error("Assistant asset failed to load.")
          );

          document.head.appendChild(asset);
        });
      }

      try {
        await Promise.all([
          loadAIAsset(
            "link",
            "/manager-ai-chat.css?v=threads-1"
          ),
          loadAIAsset(
            "script",
            "/manager-ai-widget.js?v=threads-1"
          )
        ]);

        window.mountManagerAIWidget();

        await loadAIAsset(
          "script",
          "/manager-ai-chat.js?v=threads-1"
        );
      } catch {
        document.getElementById(
          "manager-ai-widget"
        )?.remove();

        window.sfManagerAILoading = false;

        console.warn(
          "Manager assistant could not load. Refresh to try again."
        );
      }
    })();

    const header = document.createElement("header");
    header.id = "sf-manager-header";
    header.className = "sf-header";

    const top = document.createElement("div");
    top.className = "sf-header-top";

    const brand = document.createElement("a");
    brand.className = "sf-brand";
    brand.href = "/dashboard.html";
    brand.textContent = "ShopeeFood";

    const brandCaption = document.createElement("span");
    brandCaption.className = "sf-brand-caption";
    brandCaption.textContent = "DELIVERY MANAGEMENT";

    brand.appendChild(brandCaption);
    top.appendChild(brand);

    const user = document.createElement("span");
user.className = "sf-user";
user.textContent = "Mai Anh & Hong Anh Lalala · Manager";

const profile = document.createElement("div");
profile.className = "sf-sidebar-profile";

const avatar = document.createElement("span");
avatar.className = "sf-avatar";
avatar.setAttribute("aria-hidden", "true");
avatar.textContent = "MA";

profile.append(avatar, user);

    const navigation = document.createElement("nav");
    navigation.className = "sf-navigation";
    navigation.setAttribute(
      "aria-label",
      "Main navigation"
    );

    const iconPaths = {
      dashboard:
        "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",

      orders:
        "M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h4",

      dispatch:
        "M3 7h11v10H3z M14 10h4l3 4v3h-7 M5 17v3h3v-3 M16 17v3h3v-3",

      fleet:
        "M3 15l2-8h14l2 8v5h-3v-3H6v3H3z M3 13h18 M7 7l1-3h8l1 3 M6 15h2 M16 15h2",

      account:
        "M20 21v-2a6 6 0 0 0-12 0v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",

      logout:
        "M9 4H4v16h5 M13 8l4 4-4 4 M8 12h12",

      notifications:
        "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M10 21h4"
    };

    function icon(name) {
      const svg = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg"
      );

      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.7");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");

      svg.classList.add("sf-menu-icon");

      const path = document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
      );

      path.setAttribute("d", iconPaths[name]);

      svg.appendChild(path);

      return svg;
    }

    function addLink(parent, label, url) {
      const link = document.createElement("a");
      link.textContent = label;
      link.href = url;

      parent.appendChild(link);

      return link;
    }

    const dashboardLink = addLink(
      navigation,
      "Dashboard & Reports",
      "/dashboard.html"
    );

    dashboardLink.prepend(icon("dashboard"));

    if (
      window.location.pathname === "/dashboard.html"
    ) {
      dashboardLink.setAttribute(
        "aria-current",
        "page"
      );
    }
    // Keep Dashboard and Reports as separate navigation entries.
    dashboardLink.replaceChildren(
      icon("dashboard"),
      document.createTextNode("Dashboard")
    );

    const reportsGroup = document.createElement(
      "details"
    );

    reportsGroup.className = "sf-reports-menu";

    const reportsSummary = document.createElement(
      "summary"
    );

    reportsSummary.append(
      icon("orders"),
      document.createTextNode("Reports")
    );

    const reportsDropdown = document.createElement(
      "div"
    );

    reportsDropdown.className = "sf-dropdown";

    const reportNavigation = [
      ["Create Report", "/report-editor.html"],
      ["My Reports", "/my-reports.html"]
    ];

    for (const [label, href] of reportNavigation) {
      const link = addLink(
        reportsDropdown,
        label,
        href
      );

      const destination = new URL(
        href,
        window.location.origin
      );

      if (
        destination.pathname ===
        window.location.pathname
      ) {
        link.setAttribute(
          "aria-current",
          "page"
        );

        reportsSummary.classList.add(
          "sf-current-section"
        );

        reportsGroup.open = true;
      }
    }

    reportsGroup.append(
      reportsSummary,
      reportsDropdown
    );

    navigation.appendChild(reportsGroup);

    reportsGroup.addEventListener(
      "toggle",
      () => {
        if (!reportsGroup.open) return;

        navigation.querySelectorAll(
          "details"
        ).forEach(other => {
          if (other !== reportsGroup) {
            other.open = false;
          }
        });
      }
    );
    const menus = [
      [
        "Orders",
        [
          ["Pending Orders", "/?orders=pending"],
          ["All Orders", "/?orders=all"]
        ]
      ],
      [
        "Dispatch",
        [
          ["Assign / Approve", "/dispatch.html"],
          ["Reassign / Override", "/dispatch.html"],
          ["Dispatch History", "/dispatch-history.html"]
        ]
      ],
      [
        "Fleet & Data",
        [
          ["Drivers", "/drivers.html"],
          ["Vehicles", "/fleet.html"],
          ["Driver Support", "/driver-support.html"]
        ]
      ]
    ];

    const menuIcons = {
      Orders: "orders",
      Dispatch: "dispatch",
      "Fleet & Data": "fleet"
    };

    const logout = document.createElement("button");
    logout.type = "button";
    logout.className = "sf-logout";

    logout.append(
      icon("logout"),
      document.createTextNode("Logout")
    );

    for (const [label, links] of menus) {
      const group = document.createElement("details");
      const summary = document.createElement("summary");
      const dropdown = document.createElement("div");

      summary.textContent = label;
      summary.prepend(icon(menuIcons[label]));

      dropdown.className = "sf-dropdown";

      let activeFound = false;

      for (const [name, url] of links) {
        const link = addLink(dropdown, name, url);

        const destination = new URL(
          url,
          window.location.origin
        );

        if (
          !activeFound &&
          destination.pathname ===
            window.location.pathname &&
          destination.search ===
            window.location.search
        ) {
          link.setAttribute("aria-current", "page");
          summary.classList.add("sf-current-section");
          group.open = true;
          activeFound = true;
        }
      }

      group.append(summary, dropdown);
      navigation.appendChild(group);

      group.addEventListener("toggle", () => {
        if (!group.open) return;

        navigation.querySelectorAll(
          "details"
        ).forEach(other => {
          if (other !== group) {
            other.open = false;
          }
        });
      });
    }

    const accountActions = document.createElement("div");
    accountActions.className = "sf-account-actions";

    const accountLink = addLink(
      accountActions,
      "Account",
      "/account.html"
    );

    accountLink.prepend(icon("account"));

    if (
      window.location.pathname === "/account.html"
    ) {
      accountLink.setAttribute("aria-current", "page");
    }

    accountActions.appendChild(logout);
    navigation.appendChild(accountActions);

    // Shared notification center.
    const notificationButtons = [];
    const notificationBadges = [];

    function createNotificationButton(id) {
      const button = document.createElement("button");

      button.type = "button";
      button.id = id;
      button.className = "sf-notification-toggle";
      button.title = "Notifications";

      button.setAttribute(
        "aria-label",
        "Open notifications"
      );

      button.setAttribute("aria-haspopup", "dialog");

      button.setAttribute(
        "aria-controls",
        "sf-notification-dialog"
      );

      button.setAttribute("aria-expanded", "false");

      const badge = document.createElement("span");
      badge.className = "sf-notification-badge";
      badge.hidden = true;
      badge.setAttribute("aria-hidden", "true");

      button.append(
        icon("notifications"),
        badge
      );

      notificationButtons.push(button);
      notificationBadges.push(badge);

      button.addEventListener(
        "click",
        openNotifications
      );

      return button;
    }

    const notificationButton = createNotificationButton(
      "sf-notification-toggle"
    );

    top.appendChild(notificationButton);

    const notificationDialog = document.createElement(
      "dialog"
    );

    notificationDialog.id = "sf-notification-dialog";
    notificationDialog.className =
      "sf-notification-dialog";

    notificationDialog.setAttribute(
      "aria-labelledby",
      "sf-notification-title"
    );

    const notificationHeading = document.createElement(
      "div"
    );

    notificationHeading.className =
      "sf-notification-heading";

    const notificationTitle = document.createElement(
      "h2"
    );

    notificationTitle.id = "sf-notification-title";
    notificationTitle.textContent = "Notifications";

    function notificationAction(text, className) {
      const button = document.createElement("button");

      button.type = "button";
      button.className = className;
      button.textContent = text;

      return button;
    }

    const closeNotifications = notificationAction(
      "Close",
      "sf-notification-close"
    );

    const notificationFilters = document.createElement(
      "div"
    );

    notificationFilters.className =
      "sf-notification-filters";

    function notificationFilter(label, options) {
      const select = document.createElement("select");
      select.setAttribute("aria-label", label);

      for (const [value, text] of options) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
      }

      return select;
    }

    const notificationTypeFilter = notificationFilter(
      "Filter notification type",
      [
        ["all", "All types"],
        ["driver_message", "Driver Messages"],
        ["wallet_request", "Wallet Requests"],
        ["overdue_order", "Overdue Orders"]
      ]
    );

    const notificationReadFilter = notificationFilter(
      "Filter read status",
      [
        ["unread", "Unread"],
        ["all", "All notifications"],
        ["read", "Read"]
      ]
    );

    notificationFilters.append(
      notificationTypeFilter,
      notificationReadFilter
    );

    notificationHeading.append(
      notificationTitle,
      notificationFilters,
      closeNotifications
    );

    const notificationTools = document.createElement(
      "div"
    );

    notificationTools.className =
      "sf-notification-tools";

    const refreshNotificationsButton = notificationAction(
      "Refresh",
      "sf-notification-action"
    );

    const markAllNotificationsButton = notificationAction(
      "Mark all as read",
      "sf-notification-action"
    );

    const notificationSearch = document.createElement(
      "input"
    );

    notificationSearch.type = "search";
    notificationSearch.placeholder =
      "Search order or notification...";

    notificationSearch.maxLength = 100;

    notificationSearch.setAttribute(
      "aria-label",
      "Search notifications"
    );

    notificationTools.append(
      notificationSearch,
      refreshNotificationsButton,
      markAllNotificationsButton
    );

    const notificationStatus = document.createElement(
      "p"
    );

    notificationStatus.className =
      "sf-notification-status";

    notificationStatus.setAttribute(
      "role",
      "status"
    );

    notificationStatus.textContent =
      "Loading notifications...";

    const notificationList = document.createElement(
      "div"
    );

    notificationList.className =
      "sf-notification-list";

    notificationList.setAttribute(
      "aria-label",
      "Notifications"
    );

    const olderNotificationsButton = notificationAction(
      "Load earlier",
      "sf-notification-action"
    );

    olderNotificationsButton.hidden = true;

    notificationDialog.append(
      notificationHeading,
      notificationTools,
      notificationStatus,
      notificationList,
      olderNotificationsButton
    );

    document.body.appendChild(notificationDialog);

    let notificationLatestId = null;
    let notificationFilterGeneration = 0;
    let notificationRefreshQueued = false;
    let notificationSearchTimer = null;
    let notificationOpener = notificationButton;

    let notificationRows = [];
    let notificationCursor = null;
    let notificationHasOlder = false;
    let notificationUnread = 0;
    let notificationBusy = false;
    let notificationStopped = false;
    let notificationTimer = null;
    let notificationController = null;

    const validNotificationId = value =>
      typeof value === "string" &&
      /^[1-9][0-9]{0,19}$/.test(value) &&
      BigInt(value) <= 18446744073709551615n;

    function notificationTarget(value) {
      if (
        typeof value !== "string" ||
        !value.startsWith("/")
      ) {
        return null;
      }

      const url = new URL(value, location.origin);

      if (
        url.origin !== location.origin ||
        ![
          "/dispatch.html",
          "/driver-support.html"
        ].includes(url.pathname)
      ) {
        return null;
      }

      return url.href;
    }

    function notificationMessage(text, error = false) {
      notificationStatus.textContent = text;

      notificationStatus.classList.toggle(
        "sf-notification-error",
        error
      );
    }

    function notificationControls() {
      refreshNotificationsButton.disabled =
        notificationBusy || notificationStopped;

      markAllNotificationsButton.disabled =
        notificationBusy ||
        notificationStopped ||
        !notificationUnread ||
        !notificationLatestId;

      olderNotificationsButton.disabled =
        notificationBusy || notificationStopped;

      olderNotificationsButton.hidden =
        !notificationCursor;

      notificationList.querySelectorAll(
        "button"
      ).forEach(button => {
        button.disabled =
          notificationBusy || notificationStopped;
      });
    }

    function updateNotificationBadge(count) {
      notificationUnread = count;

      notificationBadges.forEach(badge => {
        badge.textContent = count > 99
          ? "99+"
          : String(count);

        badge.hidden = false;

        badge.classList.toggle(
          "sf-notification-badge-zero",
          count === 0
        );
      });

      notificationButtons.forEach(button => {
        button.classList.remove(
          "sf-notification-unavailable"
        );

        button.title = count
          ? `Notifications (${count} unread)`
          : "Notifications";

        button.setAttribute(
          "aria-label",
          count
            ? `Open notifications, ${count} unread`
            : "Open notifications, none unread"
        );
      });
    }

    async function notificationRequest(
      path,
      method = "GET",
      body
    ) {
      const controller = new AbortController();
      notificationController = controller;

      const timeout = setTimeout(
        () => controller.abort(),
        15000
      );

      try {
        const resultResponse = await fetch(
          `/api/manager-notifications${path}`,
          {
            method,
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,

            headers: method === "GET"
              ? {}
              : {
                "Content-Type": "application/json",
                "X-CSRF-Token": session.csrf_token
              },

            ...(body === undefined
              ? {}
              : {
                body: JSON.stringify(body)
              })
          }
        );

        if (
          [401, 403].includes(resultResponse.status)
        ) {
          notificationStopped = true;
          clearInterval(notificationTimer);

          throw new Error(
            "Your session or security token expired. Refresh the page or sign in again."
          );
        }

        const result = await resultResponse.json();

        if (!resultResponse.ok) {
          throw new Error(
            result.message ||
            "Notifications are unavailable. Please retry."
          );
        }

        return result;
      } finally {
        clearTimeout(timeout);

        if (
          notificationController === controller
        ) {
          notificationController = null;
        }
      }
    }

    function acceptNotifications(
      result,
      older = false
    ) {
      if (
        !result ||
        !Array.isArray(result.data) ||
        result.data.length > 50 ||
        !Number.isSafeInteger(result.unread_count) ||
        result.unread_count < 0 ||
        (
          result.next_before != null &&
          !validNotificationId(result.next_before)
        ) ||
        (
          result.latest_id != null &&
          !validNotificationId(result.latest_id)
        ) ||
        result.data.some(item =>
          !item ||
          !validNotificationId(item.id) ||
          typeof item.title !== "string" ||
          typeof item.message !== "string" ||
          !notificationTarget(item.target_url)
        )
      ) {
        throw new Error(
          "The server returned invalid notification data."
        );
      }

      if (older || notificationHasOlder) {
        const merged = new Map(
          notificationRows.map(item => [
            item.id,
            item
          ])
        );

        result.data.forEach(item => {
          merged.set(item.id, item);
        });

        notificationRows = [
          ...merged.values()
        ].sort((a, b) =>
          BigInt(a.id) > BigInt(b.id)
            ? -1
            : BigInt(a.id) < BigInt(b.id)
              ? 1
              : 0
        );
      } else {
        notificationRows = result.data;
      }

      if (older || !notificationHasOlder) {
        notificationCursor =
          result.next_before || null;
      }

      if (older) {
        notificationHasOlder = true;
      }

      notificationRows = notificationRows.filter(
        item =>
          notificationReadFilter.value === "all" ||
          (
            notificationReadFilter.value === "unread"
              ? !item.read_at
              : !!item.read_at
          )
      );

      notificationLatestId =
        result.latest_id || null;

      updateNotificationBadge(
        result.unread_count
      );

      renderNotifications();
    }

    function renderNotifications() {
      notificationList.replaceChildren();

      if (!notificationRows.length) {
        const empty = document.createElement("p");
        empty.className = "sf-notification-empty";

        empty.textContent =
          notificationReadFilter.value === "unread"
            ? "No unread notifications match your filters."
            : "No notifications match your filters.";

        notificationList.appendChild(empty);
      }

      const categories = new Map([
        [
          "overdue_order",
          {
            label: "Overdue Order",
            style: "overdue"
          }
        ],
        [
          "wallet_request",
          {
            label: "Wallet Request",
            style: "wallet"
          }
        ],
        [
          "driver_message",
          {
            label: "Driver Message",
            style: "message"
          }
        ]
      ]);

      for (const item of notificationRows) {
        const category = categories.get(
          item.notification_type
        ) || {
          label: "System",
          style: "system"
        };

        const categoryBadge = document.createElement(
          "span"
        );

        categoryBadge.className =
          `sf-notification-category sf-notification-category-${category.style}`;

        categoryBadge.textContent = category.label;

        const article = document.createElement(
          "article"
        );

        article.className = "sf-notification-item";

        article.classList.toggle(
          "sf-notification-unread",
          !item.read_at
        );

        const heading = document.createElement(
          "strong"
        );

        heading.textContent = item.title;

        const description = document.createElement(
          "p"
        );

        description.textContent = item.message;

        const time = document.createElement("small");
        const date = new Date(item.created_at);

        time.textContent = Number.isNaN(
          date.getTime()
        )
          ? "Saved notification"
          : date.toLocaleString();

        const actions = document.createElement("div");

        actions.className =
          "sf-notification-item-actions";

        const link = document.createElement("a");

        link.href = notificationTarget(
          item.target_url
        );

        link.textContent = "View details";

        link.addEventListener("click", event => {
          if (
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }

          if (item.read_at) return;

          event.preventDefault();

          notificationTask(async () => {
            await markNotificationRead(item);
            window.location.assign(link.href);
          });
        });

        actions.appendChild(link);

        if (!item.read_at) {
          const markRead = notificationAction(
            "Mark as read",
            "sf-notification-action"
          );

          markRead.addEventListener(
            "click",
            () => notificationTask(async () => {
              await markNotificationRead(item);

              acceptNotifications(
                await notificationRequest(
                  notificationQuery("/")
                )
              );

              notificationMessage(
                "Notification marked as read."
              );
            })
          );

          actions.appendChild(markRead);
        }

        const itemHeading = document.createElement(
          "div"
        );

        itemHeading.className =
          "sf-notification-item-heading";

        itemHeading.append(
          categoryBadge,
          heading
        );

        article.append(
          itemHeading,
          description,
          time,
          actions
        );

        notificationList.appendChild(article);
      }

      notificationControls();
    }

    async function markNotificationRead(item) {
      await notificationRequest(
        `/${item.id}/read`,
        "POST"
      );

      const updated = notificationRows.find(
        row => row.id === item.id
      );

      if (updated && !updated.read_at) {
        updated.read_at =
          new Date().toISOString();

        updateNotificationBadge(
          Math.max(0, notificationUnread - 1)
        );
      }
    }

    async function notificationTask(task) {
      if (
        notificationBusy ||
        notificationStopped
      ) {
        return;
      }

      notificationBusy = true;
      notificationControls();

      try {
        await task();
      } catch (error) {
        notificationMessage(
          error.name === "AbortError"
            ? "Notifications timed out. Use Refresh to retry."
            : error.message,
          true
        );

        notificationButtons.forEach(button => {
          button.classList.add(
            "sf-notification-unavailable"
          );

          button.title =
            "Notifications could not be updated";

          button.setAttribute(
            "aria-label",
            "Open notifications, update unavailable"
          );
        });
      } finally {
        notificationBusy = false;
        notificationControls();

        if (
          notificationRefreshQueued &&
          !notificationStopped
        ) {
          notificationRefreshQueued = false;
          refreshNotifications();
        }
      }
    }

    function notificationQuery(
      path,
      before = null
    ) {
      const params = new URLSearchParams({
        type: notificationTypeFilter.value,
        state: notificationReadFilter.value,
        q: notificationSearch.value.trim()
      });

      if (before) {
        params.set("before", before);
      }

      return `${path}?${params}`;
    }

    function refreshNotifications() {
      if (document.hidden) return;

      return notificationTask(async () => {
        const generation =
          notificationFilterGeneration;

        const result = await notificationRequest(
          notificationQuery("/sync"),
          "POST"
        );

        if (
          generation !==
          notificationFilterGeneration
        ) {
          notificationRefreshQueued = true;
          return;
        }

        acceptNotifications(result);
        notificationMessage("");
      });
    }

    function openNotifications(event) {
      if (notificationDialog.open) {
        notificationDialog.close();
        return;
      }

      notificationOpener =
        event?.currentTarget ||
        notificationButton;

      notificationDialog.show();

      notificationButtons.forEach(button => {
        button.setAttribute(
          "aria-expanded",
          "true"
        );
      });

      refreshNotifications();
    }

    refreshNotificationsButton.addEventListener(
      "click",
      refreshNotifications
    );

    markAllNotificationsButton.addEventListener(
      "click",
      () => notificationTask(async () => {
        const throughId = notificationLatestId;

        if (!validNotificationId(throughId)) {
          return;
        }

        await notificationRequest(
          "/read-all",
          "POST",
          {
            through_id: throughId
          }
        );

        notificationRows.forEach(item => {
          if (
            BigInt(item.id) <= BigInt(throughId)
          ) {
            item.read_at ||=
              new Date().toISOString();
          }
        });

        notificationHasOlder = false;
        notificationRows = [];
        notificationCursor = null;

        acceptNotifications(
          await notificationRequest(
            notificationQuery("/")
          )
        );

        notificationMessage(
          "Notifications marked as read."
        );
      })
    );

    olderNotificationsButton.addEventListener(
      "click",
      () => notificationTask(async () => {
        if (!notificationCursor) return;

        acceptNotifications(
          await notificationRequest(
            notificationQuery(
              "/",
              notificationCursor
            )
          ),
          true
        );

        notificationMessage("");
      })
    );

    function changeNotificationFilter() {
      notificationFilterGeneration++;
      notificationHasOlder = false;
      notificationCursor = null;

      notificationMessage(
        "Loading notifications..."
      );

      if (notificationBusy) {
        notificationRefreshQueued = true;
      } else {
        refreshNotifications();
      }
    }

    notificationTypeFilter.addEventListener(
      "change",
      changeNotificationFilter
    );

    notificationReadFilter.addEventListener(
      "change",
      changeNotificationFilter
    );

    notificationSearch.addEventListener(
      "input",
      () => {
        clearTimeout(notificationSearchTimer);

        notificationSearchTimer = setTimeout(
          changeNotificationFilter,
          300
        );
      }
    );

    document.addEventListener("click", event => {
      if (
        notificationDialog.open &&
        !notificationDialog.contains(event.target) &&
        !notificationButtons.some(
          button => button.contains(event.target)
        )
      ) {
        notificationDialog.close();
      }
    });

    notificationDialog.addEventListener(
      "keydown",
      event => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();

          notificationDialog.close();
          notificationOpener.focus();
        }
      }
    );

    closeNotifications.addEventListener(
      "click",
      () => {
        notificationDialog.close();
        notificationOpener.focus();
      }
    );

    notificationDialog.addEventListener(
      "close",
      () => {
        notificationButtons.forEach(button => {
          button.setAttribute(
            "aria-expanded",
            "false"
          );
        });
      }
    );

    notificationDialog.addEventListener(
      "click",
      event => {
        if (
          event.target !== notificationDialog
        ) {
          return;
        }

        const rect =
          notificationDialog.getBoundingClientRect();

        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        ) {
          notificationDialog.close();
        }
      }
    );

    function startNotificationPolling() {
      clearInterval(notificationTimer);

      if (notificationStopped) return;

      refreshNotifications();

      notificationTimer = setInterval(
        refreshNotifications,
        10000
      );
    }

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) {
          refreshNotifications();
        }
      }
    );

    window.addEventListener("pagehide", () => {
      clearInterval(notificationTimer);
      clearTimeout(notificationSearchTimer);
      notificationController?.abort();
    });

    window.addEventListener("pageshow", event => {
      if (event.persisted) {
        startNotificationPolling();
      }
    });

    let signingOut = false;

    logout.addEventListener(
      "click",
      async event => {
        event.preventDefault();

        if (signingOut) return;

        signingOut = true;
        logout.textContent = "Signing out…";
        logout.disabled = true;

        try {
          const result = await fetch(
            "/api/auth/logout",
            {
              method: "POST",
              headers: {
                "X-CSRF-Token": session.csrf_token
              }
            }
          );

          if (!result.ok) {
            throw new Error(
              "Unable to sign out. Please try again."
            );
          }

          window.location.replace("/login.html");
        } catch (error) {
          logout.replaceChildren(
            icon("logout"),
            document.createTextNode("Logout")
          );

          window.alert(error.message);
        } finally {
          signingOut = false;
          logout.disabled = false;
        }
      }
    );

    header.append(
      top,
      navigation,
      profile
    );

    const oldHeader = document.querySelector(
      "body > header"
    );

    if (oldHeader) {
      oldHeader.style.display = "none";
    }

    document.body.prepend(header);

    // Mobile navigation drawer.
    const mobileBar = document.createElement("div");
    mobileBar.className = "sf-mobile-bar";

    const menuToggle = document.createElement("button");
    menuToggle.type = "button";
    menuToggle.className = "sf-sidebar-toggle";
    menuToggle.textContent = "☰";

    menuToggle.setAttribute(
      "aria-label",
      "Open navigation"
    );

    menuToggle.setAttribute(
      "aria-controls",
      header.id
    );

    menuToggle.setAttribute(
      "aria-expanded",
      "false"
    );

    const mobileBrand = document.createElement("a");
    mobileBrand.href = "/dashboard.html";
    mobileBrand.textContent = "ShopeeFood";

    const mobileNotificationButton =
      createNotificationButton(
        "sf-mobile-notification-toggle"
      );

    mobileBar.append(
      menuToggle,
      mobileBrand,
      mobileNotificationButton
    );

    const backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "sf-sidebar-backdrop";

    backdrop.setAttribute(
      "aria-label",
      "Close navigation"
    );

    backdrop.tabIndex = -1;
    backdrop.hidden = true;

    document.body.prepend(mobileBar);
    document.body.appendChild(backdrop);

    const mobileQuery = window.matchMedia(
      "(max-width: 900px)"
    );

    let returnFocus = null;

    function setDrawer(
      open,
      restoreFocus = true
    ) {
      const isOpen = open && mobileQuery.matches;

      document.body.classList.toggle(
        "sf-sidebar-open",
        isOpen
      );

      menuToggle.setAttribute(
        "aria-expanded",
        String(isOpen)
      );

      menuToggle.setAttribute(
        "aria-label",
        isOpen
          ? "Close navigation"
          : "Open navigation"
      );

      header.inert =
        mobileQuery.matches && !isOpen;

      backdrop.hidden = !isOpen;

      if (isOpen) {
        returnFocus = document.activeElement;
        header.querySelector("a")?.focus();
      } else if (
        restoreFocus &&
        returnFocus &&
        mobileQuery.matches
      ) {
        returnFocus.focus();
        returnFocus = null;
      }
    }

    menuToggle.addEventListener("click", () => {
      setDrawer(
        !document.body.classList.contains(
          "sf-sidebar-open"
        )
      );
    });

    backdrop.addEventListener(
      "click",
      () => setDrawer(false)
    );

    mobileQuery.addEventListener(
      "change",
      () => setDrawer(false, false)
    );

    setDrawer(false, false);

    document.addEventListener(
      "keydown",
      event => {
        if (notificationDialog.open) {
          if (event.key === "Escape") {
            event.preventDefault();

            notificationDialog.close();
            notificationOpener.focus();
          }

          return;
        }

        if (
          !document.body.classList.contains(
            "sf-sidebar-open"
          )
        ) {
          return;
        }

        if (event.key === "Escape") {
          setDrawer(false);
        } else if (event.key === "Tab") {
          const focusable = [
            ...header.querySelectorAll(
              "a, button, summary"
            )
          ].filter(item =>
            !item.disabled &&
            item.getClientRects().length
          );

          const first = focusable[0];
          const last =
            focusable[focusable.length - 1];

          if (
            event.shiftKey &&
            document.activeElement === first
          ) {
            event.preventDefault();
            last?.focus();
          } else if (
            !event.shiftKey &&
            document.activeElement === last
          ) {
            event.preventDefault();
            first?.focus();
          }
        }
      }
    );

    startNotificationPolling();

    const orderView = new URLSearchParams(
      window.location.search
    ).get("orders");

    if (
      window.location.pathname === "/" &&
      orderView
    ) {
      const pattern = orderView === "pending"
        ? /pending orders/i
        : /all orders/i;

      const button = [
        ...document.querySelectorAll(
          "main button"
        )
      ].find(item =>
        pattern.test(item.textContent)
      );

      button?.click();
    }
     return true;
  } catch {
    console.error(
      "Unable to load shared navigation."
    );

    return false;
  }
})();
