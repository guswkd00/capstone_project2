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

async function notifyWithdrawal(user, withdrawal) {
  if (!emailEnabled()) return false;

  const amount = new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(Number(withdrawal.amount));

  const time = new Date().toLocaleString("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh"
  });

  try {
    await sendEmail(
      user.email,
      user.full_name,
      "Withdrawal approved — ShopeeFood Delivery DSS",
      `Hello ${user.full_name},\n\n` +
      "A Manager has approved your withdrawal request.\n" +
      `Request ID: ${withdrawal.id}\n` +
      `Amount: ${amount}\n` +
      `Reference: ${withdrawal.reference}\n` +
      `Notification time: ${time} (Vietnam time)\n\n` +
      "The approved withdrawal has been recorded in your application wallet.\n" +
      "This application does not initiate bank transfers or independently verify receipt in your bank account.\n" +
      "If the funds have not arrived, contact your Manager with the request ID and reference.\n\n" +
      "View your wallet:\n" +
      applicationUrl("/driver.html") +
      "\n\nAcademic prototype — not an official ShopeeFood service."
    );

    return true;
  } catch (error) {
    console.error(
      "Withdrawal email failed:",
      error.code || error.name
    );

    return false;
  }
}

module.exports = {
  emailEnabled,
  applicationUrl,
  sendEmail,
  notify,
  notifyWithdrawal
};
function deviceLabel(userAgent) {
  if (
    typeof userAgent !== "string" ||
    !userAgent.trim()
  ) {
    return "Không xác định";
  }

  const text = userAgent.slice(0, 1000);

  const os = /Android/i.test(text)
    ? "Android"
    : /iPhone|iPad/i.test(text)
      ? "iOS"
      : /Windows/i.test(text)
        ? "Windows"
        : /Macintosh/i.test(text)
          ? "macOS"
          : /Linux/i.test(text)
            ? "Linux"
            : "Không xác định";

  const browser = /Edg\//.test(text)
    ? "Edge"
    : /Firefox\//.test(text)
      ? "Firefox"
      : /Chrome\//.test(text)
        ? "Chrome"
        : /Safari\//.test(text)
          ? "Safari"
          : "Không xác định";

  return `${browser} / ${os}`;
}

async function notifyLogin(user, request = {}) {
  const managerEmail = (
    process.env.MANAGER_LOGIN_EMAIL || ""
  ).trim().toLowerCase();

  const validEmail = email =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    email.length <= 150;

  if (!validEmail(managerEmail)) {
    console.warn(
      JSON.stringify({
        event: "login_email_config",
        reason: "missing_or_invalid_manager_recipient",
      })
    );
  }

  // A normalized address receives only one email per event.
  const recipients = new Map();

  if (validEmail(user.email || "")) {
    recipients.set(
      user.email.trim().toLowerCase(),
      user.full_name
    );
  }

  if (validEmail(managerEmail)) {
    recipients.set(managerEmail, "Manager");
  }

  const timestamp = new Date().toLocaleString(
    "en-GB",
    {
      timeZone: "Asia/Ho_Chi_Minh",
    }
  );

  const text =
    "Successful sign-in — ShopeeFood Delivery DSS\n\n" +
    `Role: ${user.role || "Không xác định"}\n` +
    `Name: ${user.full_name || "Không xác định"}\n` +
    `Account: ${user.email || "Không xác định"}\n` +
    `Time: ${timestamp} (Asia/Ho_Chi_Minh)\n` +
    `IP: ${request.ip || "Không xác định"}\n` +
    `Device: ${deviceLabel(request.userAgent)}\n\n` +
    "If this was unexpected, review the account's security.";

  await Promise.all(
    [...recipients].map(async ([email, name]) => {
      try {
        await sendEmail(
          email,
          name,
          "Successful sign-in — ShopeeFood Delivery DSS",
          text
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            event: "login_email_failed",
            user_id: user.id,
            code: error.code || error.name,
            reason: emailEnabled()
              ? "provider_error"
              : "missing_email_config",
          })
        );
      }
    })
  );
}

module.exports.notifyLogin = notifyLogin;
module.exports.deviceLabel = deviceLabel;
