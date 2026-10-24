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

    document.documentElement.style.visibility = "";

    const navigation = document.querySelector("header nav");

    if (
      navigation &&
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