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
