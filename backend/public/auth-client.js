(() => {
  const originalFetch = window.fetch.bind(window);

  const requiredRole =
    document.currentScript?.dataset.role || "";

  document.documentElement.style.visibility = "hidden";

  async function checkSession() {
    try {
      const response = await originalFetch("/api/auth/me", {
        credentials: "same-origin",
        cache: "no-store"
      });

      if (response.status === 401) {
        window.location.replace("/login.html");
        return null;
      }

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || "Unable to verify your session.");
      }

      if (requiredRole && result.user.role !== requiredRole) {
        window.location.replace("/account.html");
        return null;
      }

      return result;
    } catch (error) {
      window.location.replace("/login.html");
      return null;
    }
  }

  const sessionReady = checkSession();
  window.sfSessionReady = sessionReady;

  window.fetch = async function(input, options = {}) {
    const requestUrl = input instanceof Request
      ? input.url
      : String(input);

    const url = new URL(requestUrl, window.location.href);

    const isLocalApi =
      url.origin === window.location.origin &&
      url.pathname.startsWith("/api/");

    if (!isLocalApi) {
      return originalFetch(input, options);
    }

    const session = await sessionReady;

    if (!session) {
      throw new Error("Please sign in.");
    }

    const method = (
      options.method ||
      (input instanceof Request ? input.method : "GET")
    ).toUpperCase();

    const headers = new Headers(
      options.headers ||
      (input instanceof Request ? input.headers : undefined)
    );

    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      headers.set("X-CSRF-Token", session.csrf_token);
    }

    const response = await originalFetch(input, {
      ...options,
      headers,
      credentials: "same-origin"
    });

    if (response.status === 401) {
      window.location.replace("/login.html");
    }

    return response;
  };

  async function showAuthenticatedPage() {
    const session = await sessionReady;
    if (!session) return;

    // A bare entry URL opens the Manager overview; explicit Orders links stay intact.
    const entryUrl = new URL(window.location.href);
    if (session.user.role === "manager" &&
        ["/", "/index.html"].includes(entryUrl.pathname) &&
        !entryUrl.searchParams.has("orders")) {
      window.location.replace("/dashboard.html");
      return;
    }
    if (session.user.role === "manager") {
  const shellReady = await window.sfManagerShellReady;

  if (
    !shellReady ||
    !document.getElementById("sf-manager-header")
  ) {
    const errorPanel = document.createElement("main");

    errorPanel.setAttribute("role", "alert");
    errorPanel.style.cssText =
      "max-width:640px;margin:60px auto;" +
      "padding:24px;font-family:Arial,sans-serif";

    const title = document.createElement("h1");
    title.textContent = "Unable to load navigation";

    const description = document.createElement("p");
    description.textContent =
      "Please reload the page to try again.";

    const retryButton = document.createElement("button");
    retryButton.textContent = "Reload page";

    retryButton.addEventListener("click", () => {
      window.location.reload();
    });

    errorPanel.append(
      title,
      description,
      retryButton
    );

    document.body.replaceChildren(errorPanel);

    document.body.classList.remove(
      "sf-manager-layout",
      "sf-sidebar-open"
    );

    document.documentElement.style.visibility = "";
    return;
  }
}

    document.documentElement.style.visibility = "";

    const navigation = document.querySelector("header nav");

    if (
      navigation &&
      !navigation.querySelector("[data-account-menu]") &&
      !navigation.querySelector('a[href="/account.html"]')
    ) {
      const link = document.createElement("a");
      link.href = "/account.html";
      link.textContent = "Account";
      link.style.color = "inherit";
      navigation.appendChild(link);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      showAuthenticatedPage,
      { once: true }
    );
  } else {
    showAuthenticatedPage();
  }
})();
