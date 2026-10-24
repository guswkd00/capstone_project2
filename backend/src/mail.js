function settings() {
  const key = process.env.BREVO_API_KEY;
  const from = process.env.EMAIL_FROM;
  const base = process.env.APP_PUBLIC_URL;

  if (!key || !from || !base) return null;

  try {
    const url = new URL(base);
    const local = ["localhost", "127.0.0.1"].includes(
      url.hostname
    );

    if (
      url.protocol !== "https:" &&
      !(local && url.protocol === "http:")
    ) {
      return null;
    }

    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      return null;
    }

    return {
      key,
      from,
      origin: url.origin,
    };
  } catch {
    return null;
  }
}

function emailEnabled() {
  return settings() !== null;
}

function applicationUrl(path) {
  const config = settings();

  if (!config) {
    throw new Error("Email delivery is not configured.");
  }

  return new URL(path, config.origin).toString();
}

async function sendEmail(email, name, subject, text) {
  const config = settings();

  if (!config) {
    throw new Error("Email delivery is not configured.");
  }

  const response = await fetch(
    "https://api.brevo.com/v3/smtp/email",
    {
      method: "POST",
      headers: {
        "api-key": config.key,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        sender: {
          email: config.from,
          name:
            process.env.EMAIL_FROM_NAME ||
            "ShopeeFood Delivery DSS",
        },
        to: [{ email, name }],
        subject,
        textContent: text,
      }),
    }
  );

  if (!response.ok) {
    const error = new Error(
      "Email provider rejected the request."
    );

    error.code = `MAIL_HTTP_${response.status}`;
    throw error;
  }

  await response.arrayBuffer();
}

function notify(user, kind, ip) {
  if (!emailEnabled()) return;

  const time = new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
  });

  const title =
    kind === "login"
      ? "Successful sign-in"
      : "Password changed";

  let text =
    `Hello ${user.full_name},\n\n` +
    `${title} for your ShopeeFood Delivery DSS account.\n` +
    `Time: ${time} (Vietnam time)\n` +
    `Account role: ${user.role}\n`;

  if (ip) {
    text += `Request IP: ${ip}\n`;
  }

  text +=
    "\nIf this was not you, reset your password:\n" +
    applicationUrl("/forgot-password.html") +
    "\n\nAcademic prototype — not an official ShopeeFood service.";

  sendEmail(
    user.email,
    user.full_name,
    `${title} — ShopeeFood Delivery DSS`,
    text
  ).catch((error) => {
    console.error(
      "Security email failed:",
      error.code || error.name
    );
  });
}

module.exports = {
  emailEnabled,
  applicationUrl,
  sendEmail,
  notify,
};
