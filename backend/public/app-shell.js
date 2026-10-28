(async () => {
  if (document.getElementById("sf-manager-header")) return;

  try {
    const response = await fetch("/api/auth/me", {
      cache: "no-store"
    });

    if (!response.ok) return;

    const session = await response.json();

    if (session.user.role !== "manager") return;

    document.body.classList.add("sf-app", "sf-manager-layout");
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
          loadAIAsset("link", "/manager-ai-chat.css?v=threads-1"),
          loadAIAsset("script", "/manager-ai-widget.js?v=threads-1")
        ]);

        window.mountManagerAIWidget();

        await loadAIAsset(
          "script",
          "/manager-ai-chat.js?v=threads-1"
        );
      } catch {
        document.getElementById("manager-ai-widget")?.remove();
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

    const user = document.createElement("span");
    user.className = "sf-user";
    user.textContent =
      `${session.user.full_name} · Manager`;

    const brandCaption = document.createElement("span");
    brandCaption.className = "sf-brand-caption";
    brandCaption.textContent = "DELIVERY MANAGEMENT";
    brand.appendChild(brandCaption);
    top.append(brand);

    const profile = document.createElement("div");
    profile.className = "sf-sidebar-profile";
    const avatar = document.createElement("span");
    avatar.className = "sf-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = (session.user.full_name || "M").trim().slice(0, 1).toUpperCase();
    profile.append(avatar, user);

    const navigation = document.createElement("nav");
    navigation.className = "sf-navigation";
    navigation.setAttribute("aria-label", "Main navigation");

    const iconPaths = {
      dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
      orders: "M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h4",
      dispatch: "M3 7h11v10H3z M14 10h4l3 4v3h-7 M5 17v3h3v-3 M16 17v3h3v-3",
      fleet: "M3 15l2-8h14l2 8v5h-3v-3H6v3H3z M3 13h18 M7 7l1-3h8l1 3 M6 15h2 M16 15h2",
      account: "M20 21v-2a6 6 0 0 0-12 0v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
      logout: "M9 4H4v16h5 M13 8l4 4-4 4 M8 12h12"
    };
    function icon(name) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "1.7");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");
      svg.classList.add("sf-menu-icon");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
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

    const dashboardLink = addLink(navigation, "Dashboard & Reports", "/dashboard.html");
    dashboardLink.prepend(icon("dashboard"));
    if (window.location.pathname === "/dashboard.html") {
      dashboardLink.setAttribute("aria-current", "page");
    }

    const menus = [
      ["Orders", [
        ["Pending Orders", "/?orders=pending"],
        ["All Orders", "/?orders=all"]
      ]],
      ["Dispatch", [
        ["Assign / Approve", "/dispatch.html"],
        ["Reassign / Override", "/dispatch.html"],
        ["Dispatch History", "/dispatch-history.html"]
      ]],
     ["Fleet & Data", [
        ["Drivers", "/drivers.html"],
        ["Vehicles", "/fleet.html"],
        ["Driver Support", "/driver-support.html"]
      ]]
    ];

    const logout = document.createElement("button");
    logout.type = "button";
    logout.className = "sf-logout";
    logout.append(icon("logout"), document.createTextNode("Logout"));

    for (const [label, links] of menus) {
      const group = document.createElement("details");
      const summary = document.createElement("summary");
      const dropdown = document.createElement("div");

      summary.textContent = label;
      summary.prepend(icon({Orders: "orders", Dispatch: "dispatch", "Fleet & Data": "fleet"}[label]));
      dropdown.className = "sf-dropdown";

      let activeFound = false;
      for (const [name, url] of links) {
        const link = addLink(dropdown, name, url);
        const destination = new URL(url, window.location.origin);
        if (!activeFound && destination.pathname === window.location.pathname &&
            destination.search === window.location.search) {
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

        navigation.querySelectorAll("details").forEach(other => {
          if (other !== group) other.open = false;
        });
      });
    }

    const accountActions = document.createElement("div");
    accountActions.className = "sf-account-actions";

    const accountLink = addLink(accountActions, "Account", "/account.html");
    accountLink.prepend(icon("account"));

    if (window.location.pathname === "/account.html") {
      accountLink.setAttribute("aria-current", "page");
    }

    accountActions.appendChild(logout);
    navigation.appendChild(accountActions);

    // Keep the existing dashboard reminders available in the shared shell.
    const notificationButton = document.createElement("button");
    notificationButton.type = "button";
    notificationButton.id = "sf-notification-toggle";
    notificationButton.className = "sf-notification-toggle";
    notificationButton.title = "Notifications";
    notificationButton.setAttribute("aria-label", "Open notifications");
    notificationButton.setAttribute("aria-haspopup", "dialog");
    notificationButton.setAttribute("aria-controls", "sf-notification-dialog");
    notificationButton.setAttribute("aria-expanded", "false");

    iconPaths.notifications =
      "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M10 21h4";
    notificationButton.appendChild(icon("notifications"));
    top.appendChild(notificationButton);

    const notificationDialog = document.createElement("dialog");
    notificationDialog.id = "sf-notification-dialog";
    notificationDialog.className = "sf-notification-dialog";
    notificationDialog.setAttribute("aria-labelledby", "sf-notification-title");

    const notificationHeading = document.createElement("div");
    notificationHeading.className = "sf-notification-heading";
    const notificationTitle = document.createElement("h2");
    notificationTitle.id = "sf-notification-title";
    notificationTitle.textContent = "System Notifications";

    const closeNotifications = document.createElement("button");
    closeNotifications.type = "button";
    closeNotifications.className = "sf-notification-close";
    closeNotifications.textContent = "Close";
    notificationHeading.append(notificationTitle, closeNotifications);

    const notificationList = document.createElement("div");
    notificationList.className = "sf-notification-list";

    for (const [title, message] of [
      [
        "ShopeeFood DSS",
        "Refresh the report to retrieve the latest recorded delivery metrics and COD records."
      ],
      [
        "Dispatch Reminder",
        "Check overdue open orders in the metrics summary."
      ]
    ]) {
      const item = document.createElement("article");
      item.className = "sf-notification-item";
      const heading = document.createElement("strong");
      heading.textContent = title;
      const description = document.createElement("p");
      description.textContent = message;
      item.append(heading, description);
      notificationList.appendChild(item);
    }

    const reportLink = addLink(
      notificationList, "Open Dashboard & Reports", "/dashboard.html"
    );
    reportLink.className = "sf-notification-report";
    notificationDialog.append(notificationHeading, notificationList);
    document.body.appendChild(notificationDialog);

    notificationButton.addEventListener("click", () => {
      if (notificationDialog.open) return;
      notificationDialog.showModal();
      notificationButton.setAttribute("aria-expanded", "true");
    });

    closeNotifications.addEventListener("click", () => {
      notificationDialog.close();
    });

    notificationDialog.addEventListener("close", () => {
      notificationButton.setAttribute("aria-expanded", "false");
    });

    notificationDialog.addEventListener("click", event => {
      if (event.target !== notificationDialog) return;
      const rect = notificationDialog.getBoundingClientRect();
      if (
        event.clientX < rect.left || event.clientX > rect.right ||
        event.clientY < rect.top || event.clientY > rect.bottom
      ) {
        notificationDialog.close();
      }
    });

    let signingOut = false;

    logout.addEventListener("click", async event => {
      event.preventDefault();

      if (signingOut) return;

      signingOut = true;
      logout.textContent = "Signing out…";
      logout.disabled = true;

      try {
        const result = await fetch("/api/auth/logout", {
          method: "POST",
          headers: {
            "X-CSRF-Token": session.csrf_token
          }
        });

        if (!result.ok) {
          throw new Error("Unable to sign out. Please try again.");
        }

        window.location.replace("/login.html");
      } catch (error) {
        logout.replaceChildren(icon("logout"), document.createTextNode("Logout"));
        window.alert(error.message);
      } finally {
        signingOut = false;
        logout.disabled = false;
      }
    });

    header.append(top, navigation, profile);

    const oldHeader = document.querySelector("body > header");

    if (oldHeader) {
      oldHeader.style.display = "none";
    }

    document.body.prepend(header);

    // On narrow screens, expose the same navigation as a left drawer.
    const mobileBar = document.createElement("div");
    mobileBar.className = "sf-mobile-bar";
    const menuToggle = document.createElement("button");
    menuToggle.type = "button";
    menuToggle.className = "sf-sidebar-toggle";
    menuToggle.textContent = "☰";
    menuToggle.setAttribute("aria-label", "Open navigation");
    menuToggle.setAttribute("aria-controls", header.id);
    menuToggle.setAttribute("aria-expanded", "false");
    const mobileBrand = document.createElement("a");
    mobileBrand.href = "/dashboard.html";
    mobileBrand.textContent = "ShopeeFood";
    mobileBar.append(menuToggle, mobileBrand);
    const backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "sf-sidebar-backdrop";
    backdrop.setAttribute("aria-label", "Close navigation");
    backdrop.tabIndex = -1;
    backdrop.hidden = true;
    document.body.prepend(mobileBar);
    document.body.appendChild(backdrop);

    const mobileQuery = window.matchMedia("(max-width: 900px)");
    let returnFocus = null;
    function setDrawer(open, restoreFocus = true) {
      const isOpen = open && mobileQuery.matches;
      document.body.classList.toggle("sf-sidebar-open", isOpen);
      menuToggle.setAttribute("aria-expanded", String(isOpen));
      menuToggle.setAttribute("aria-label", isOpen ? "Close navigation" : "Open navigation");
      header.inert = mobileQuery.matches && !isOpen;
      backdrop.hidden = !isOpen;
      if (isOpen) {
        returnFocus = document.activeElement;
        header.querySelector("a")?.focus();
      } else if (restoreFocus && returnFocus && mobileQuery.matches) {
        returnFocus.focus();
        returnFocus = null;
      }
    }
    menuToggle.addEventListener("click", () => {
      setDrawer(!document.body.classList.contains("sf-sidebar-open"));
    });
    backdrop.addEventListener("click", () => setDrawer(false));
    mobileQuery.addEventListener("change", () => setDrawer(false, false));
    setDrawer(false, false);

    document.addEventListener("keydown", event => {
      if (notificationDialog.open) return;
      if (!document.body.classList.contains("sf-sidebar-open")) return;
      if (event.key === "Escape") {
        setDrawer(false);
      } else if (event.key === "Tab") {
        const focusable = [...header.querySelectorAll("a, button, summary")]
          .filter(item => !item.disabled && item.getClientRects().length);
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    });

    const orderView =
      new URLSearchParams(window.location.search).get("orders");

    if (window.location.pathname === "/" && orderView) {
      const pattern = orderView === "pending"
        ? /pending orders/i
        : /all orders/i;

      const button = [...document.querySelectorAll("main button")]
        .find(item => pattern.test(item.textContent));

      button?.click();
    }
  } catch (error) {
    console.error("Unable to load shared navigation.");
  }
})();
