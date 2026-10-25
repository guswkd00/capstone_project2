(() => {
  "use strict";

  // Called after app-shell.js verifies a Manager session.
  window.mountManagerAIWidget = function () {
    if (document.getElementById("manager-ai-widget")) return;

    const root = document.createElement("div");
    root.id = "manager-ai-widget";

    // Static HTML only. AI replies will use textContent.
    root.innerHTML = `
      <button
        id="mai-toggle"
        class="mai-launcher"
        type="button"
        aria-controls="mai-panel"
        aria-expanded="false"
      >
        <span aria-hidden="true">✦</span> AI Assistant
      </button>

      <section
        id="mai-panel"
        class="mai-panel"
        role="dialog"
        aria-modal="false"
        aria-labelledby="mai-title"
        hidden
      >
        <div class="mai-header">
          <div>
            <h2 id="mai-title">Dispatch Assistant</h2>
            <p>AI guidance · Manager approval required</p>
          </div>
          <button
            id="mai-close"
            type="button"
            aria-label="Close chat"
          >✕</button>
        </div>

        <div class="mai-context">
          <label for="mai-order">Order context</label>

          <select id="mai-order" disabled>
            <option value="">Loading orders...</option>
          </select>

          <p id="mai-order-info">
            Preparing dispatch context...
          </p>

          <div class="mai-tools">
            <button id="mai-refresh-orders" type="button" disabled>
              Refresh Orders
            </button>
            <button id="mai-clear" type="button" disabled>
              Clear Chat
            </button>
          </div>
        </div>

        <div
          id="mai-messages"
          class="mai-messages"
          role="log"
          aria-label="Chat messages"
          aria-live="polite"
          aria-relevant="additions"
        >
          <article class="mai-message mai-assistant">
            <strong>Dispatch Assistant</strong>
            <p>
              Select an order to compare drivers,
              or ask a general workflow question.
            </p>
          </article>
        </div>

        <form id="mai-form" class="mai-composer">
          <label for="mai-question">Your question</label>

          <textarea
            id="mai-question"
            rows="2"
            maxlength="1500"
            required
            placeholder="Which driver should handle this order?"
            aria-describedby="mai-privacy mai-status"
          ></textarea>

          <div class="mai-send-row">
            <small>Up to 1,500 characters</small>
            <button id="mai-send" type="submit" disabled>
              Send
            </button>
          </div>

          <p id="mai-status" role="status" aria-live="polite">
            Preparing assistant...
          </p>

          <p id="mai-privacy" class="mai-privacy">
            Questions and limited dispatch data are sent to Google.
            Do not enter personal details or secrets.
          </p>
        </form>
      </section>
    `;

    document.body.appendChild(root);

    const toggle = document.getElementById("mai-toggle");
    const panel = document.getElementById("mai-panel");
    const close = document.getElementById("mai-close");

    function setOpen(open) {
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));

      if (open) {
        document.getElementById("mai-question").focus();
      } else {
        toggle.focus();
      }
    }

    toggle.addEventListener("click", () => setOpen(panel.hidden));
    close.addEventListener("click", () => setOpen(false));

    root.addEventListener("keydown", event => {
      if (
        event.key === "Escape" &&
        !panel.hidden &&
        !event.defaultPrevented
      ) {
        event.preventDefault();
        setOpen(false);
      }
    });
  };
})();
