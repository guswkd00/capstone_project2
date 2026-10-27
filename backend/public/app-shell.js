(async () => {
  if (document.getElementById("sf-manager-header")) return;

  try {
    const response = await fetch("/api/auth/me", {
      cache: "no-store"
    });

    if (!response.ok) return;

    const session = await response.json();

    if (session.user.role !== "manager") return;

    document.body.classList.add("sf-app");

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
          loadAIAsset("link", "/manager-ai-chat.css?v=nvidia-1"),
          loadAIAsset("script", "/manager-ai-widget.js?v=nvidia-1")
        ]);

        window.mountManagerAIWidget();

        await loadAIAsset(
          "script",
          "/manager-ai-chat.js?v=nvidia-2"
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

    top.append(brand, user);

    const navigation = document.createElement("nav");
    navigation.className = "sf-navigation";
    navigation.setAttribute("aria-label", "Main navigation");

    function addLink(parent, label, url) {
      const link = document.createElement("a");
      link.textContent = label;
      link.href = url;
      parent.appendChild(link);
      return link;
    }

    addLink(navigation, "Dashboard", "/dashboard.html");

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
        ["Vehicles", "/fleet.html"]
      ]],
      ["Reports", [
        ["Delivery Performance", "/dashboard.html"]
      ]],
      ["Account", [
        ["Profile", "/account.html"]
      ]]
    ];

    for (const [label, links] of menus) {
      const group = document.createElement("details");
      const summary = document.createElement("summary");
      const dropdown = document.createElement("div");

      summary.textContent = label;
      dropdown.className = "sf-dropdown";

      for (const [name, url] of links) {
        addLink(dropdown, name, url);
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

    const logout = addLink(
      navigation,
      "Logout",
      "/account.html"
    );

    let signingOut = false;

    logout.addEventListener("click", async event => {
      event.preventDefault();

      if (signingOut) return;

      signingOut = true;
      logout.textContent = "Signing out…";

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
        logout.textContent = "Logout";
        window.alert(error.message);
      } finally {
        signingOut = false;
      }
    });

    header.append(top, navigation);

    const oldHeader = document.querySelector("body > header");

    if (oldHeader) {
      oldHeader.style.display = "none";
    }

    document.body.prepend(header);

    function closeMenus() {
      navigation.querySelectorAll("details").forEach(group => {
        group.open = false;
      });
    }

    document.addEventListener("click", event => {
      if (!header.contains(event.target)) closeMenus();
    });

    document.addEventListener("keydown", event => {
      if (event.key === "Escape") closeMenus();
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
