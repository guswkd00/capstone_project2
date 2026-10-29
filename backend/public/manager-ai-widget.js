(() => {
  "use strict";

  window.mountManagerAIWidget = function () {
    if (document.getElementById("manager-ai-widget")) return;

    const root = document.createElement("div");
    root.id = "manager-ai-widget";

    // Static markup. Dynamic messages must use textContent.
    root.innerHTML = `
      <button id="mai-toggle" class="mai-launcher" type="button"
        aria-controls="mai-panel" aria-expanded="false">
        <span aria-hidden="true">✦</span> AI Assistant
      </button>

      <section id="mai-panel" class="mai-panel" role="dialog"
        aria-modal="false" aria-labelledby="mai-title" hidden>

        <div class="mai-header">
          <button id="mai-sidebar-toggle" type="button"
            aria-label="Toggle conversation sidebar"
            aria-controls="mai-sidebar"
            aria-expanded="true">☰</button>

          <div class="mai-header-title">
            <h2 id="mai-title">Dispatch Assistant</h2>
            <p>AI guidance · Manager approval required</p>
          </div>

          <button id="mai-close" type="button"
            aria-label="Close chat">✕</button>
        </div>

        <div class="mai-workspace">
          <aside id="mai-sidebar" class="mai-sidebar"
            aria-label="Conversations">

            <button id="mai-clear" class="mai-new-chat"
              type="button" disabled>
              + New chat
            </button>

            <div class="mai-recents-heading">
              <h3>Recents</h3>
              <button id="mai-refresh-recents" type="button"
                aria-label="Refresh recent conversations"
                disabled>↻</button>
            </div>

            <p id="mai-recents-status" class="mai-sidebar-note">
              Preparing conversations...
            </p>

            <nav id="mai-recents"
              aria-label="Recent conversations"></nav>

            <button id="mai-more-recents" type="button" hidden>
              Load more
            </button>
          </aside>

          <div class="mai-conversation">
            <div class="mai-thread-header">
              <strong id="mai-thread-title">New chat</strong>
              <button id="mai-delete-chat" type="button" disabled>
                Delete chat
              </button>
            </div>

            <details class="mai-context" open>
              <summary>Order context</summary>

              <label for="mai-order">Select an order</label>
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
              </div>
            </details>

            <div class="mai-history-toolbar">
              <button id="mai-older-messages" type="button" hidden>
                Load earlier messages
              </button>
            </div>

            <div id="mai-messages" class="mai-messages"
              role="log" aria-label="Chat messages"
              aria-live="polite" aria-relevant="additions">
              <article class="mai-message mai-assistant">
                <strong>Dispatch Assistant</strong>
                <p>
                  Start a new chat or select a conversation from Recents.
                </p>
              </article>
            </div>

            <form id="mai-form" class="mai-composer">
              <label for="mai-question">Your question</label>

              <textarea id="mai-question" rows="2"
                maxlength="1500" required
                placeholder="Ask about dispatch, drivers or COD..."
                aria-describedby="mai-privacy mai-status"></textarea>

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
                Questions and limited dispatch data may be sent to NVIDIA or Google, depending on the configured AI provider.
                Chat history is stored when saving succeeds.
                Do not enter personal details or secrets.
              </p>
            </form>
          </div>
        </div>
      </section>
    `;

    document.body.appendChild(root);

    const toggle = document.getElementById("mai-toggle");
    const panel = document.getElementById("mai-panel");
    const close = document.getElementById("mai-close");
    const sidebar = document.getElementById("mai-sidebar");
    const sidebarToggle =
      document.getElementById("mai-sidebar-toggle");

    function setSidebar(open) {
      sidebar.hidden = !open;
      sidebarToggle.setAttribute("aria-expanded", String(open));
      root.dataset.sidebarOpen = String(open);
    }

    sidebarToggle.addEventListener("click", () => {
      setSidebar(sidebar.hidden);
    });

    setSidebar(window.matchMedia("(min-width: 701px)").matches);

    function setOpen(open) {
      panel.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));

      if (open) {
        document.getElementById("mai-question").focus();
        root.dispatchEvent(new CustomEvent("mai:open"));
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
