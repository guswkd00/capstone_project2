(() => {
  const main = document.querySelector("main");
  if (!main) return;

  const section = document.createElement("section");
  section.className = "card";
  section.style.margin = "24px 0";

  section.innerHTML = `
    <h2>Create Demo Driver Accounts</h2>

    <p>
      Create login accounts for up to 60 existing demo drivers.
      Existing accounts and the Manager password are unchanged.
    </p>

    <form id="demo-accounts-form">
      <label>
        Base Gmail address — without a +alias
        <input
          name="email_base"
          type="email"
          placeholder="yourname@gmail.com"
          required
        >
      </label>

      <br>

      <label>
        Initial password for demo drivers
        <input
          name="password"
          type="password"
          minlength="12"
          maxlength="200"
          autocomplete="new-password"
          required
        >
      </label>

      <p>
        Use a separate password for these demo accounts.
        Save it privately before continuing.
      </p>

      <button type="button" id="show-demo-password">
        Show Password
      </button>

      <button type="submit" class="primary">
        Create Demo Accounts
      </button>
    </form>

    <p id="demo-accounts-message" role="status"></p>
    <div id="demo-accounts-results"></div>
  `;

  const heading = main.querySelector("h1");

  if (heading) {
    heading.after(section);
  } else {
    main.prepend(section);
  }

  const form = section.querySelector("#demo-accounts-form");
  const email = form.elements.email_base;
  const password = form.elements.password;
  const show = section.querySelector("#show-demo-password");
  const submit = form.querySelector('button[type="submit"]');
  const message = section.querySelector("#demo-accounts-message");
  const results = section.querySelector("#demo-accounts-results");

  let creating = false;

  fetch("/api/auth/me", { cache: "no-store" })
    .then(response => {
      if (!response.ok) throw new Error("Session unavailable.");
      return response.json();
    })
    .then(session => {
      if (!email.value) {
        email.value = session.user.email;
      }
    })
    .catch(() => {});

  show.addEventListener("click", () => {
    const visible = password.type === "password";
    password.type = visible ? "text" : "password";
    show.textContent = visible ? "Hide Password" : "Show Password";
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();

    if (creating || !form.reportValidity()) return;

    const body = {
      email_base: email.value.trim(),
      password: password.value
    };

    creating = true;
    submit.disabled = true;
    show.disabled = true;
    email.disabled = true;
    password.disabled = true;

    message.textContent =
      "Creating accounts. This may take a little while. " +
      "Keep this page open.";

    results.replaceChildren();

    try {
      const response = await fetch(
        "/api/fleet/demo-driver-accounts",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.message || "Unable to create demo accounts."
        );
      }

      message.textContent = result.message;

      const accounts = Array.isArray(result.accounts)
        ? result.accounts
        : [];

      if (!accounts.length) {
        results.textContent =
          "No new accounts were created. " +
          "The demo drivers may already have login accounts.";
        return;
      }

      const note = document.createElement("p");
      note.textContent =
        "The accounts below use the initial password you entered. " +
        "No email has been sent.";
      results.appendChild(note);

      const list = document.createElement("ul");

      for (const account of accounts) {
        const item = document.createElement("li");

        item.textContent =
          `${account.driver_code} · ` +
          `${account.full_name} · ` +
          account.email;

        list.appendChild(item);
      }

      results.appendChild(list);
    } catch (error) {
      message.textContent = error.message;
    } finally {
      creating = false;
      submit.disabled = false;
      show.disabled = false;
      email.disabled = false;
      password.disabled = false;
    }
  });
})();
