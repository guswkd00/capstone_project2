(() => {
  "use strict";

  function init() {
    const form =
      document.getElementById("driver-photo-form");

    if (!form) return;

    const avatar = document.querySelector(
      "#open-profile-btn .avatar"
    );

    const preview =
      document.getElementById("driver-photo-preview");

    const fileInput =
      document.getElementById("driver-photo-file");

    const remove =
      document.getElementById("driver-photo-remove");

    const status =
      document.getElementById("driver-photo-status");

    const close =
      document.getElementById("close-profile");

    let fullName = "Driver";
    let photoUrl = null;
    let busy = false;
    let version = 0;

    function paint() {
      for (const target of [avatar, preview]) {
        target.replaceChildren();

        if (photoUrl) {
          const img = document.createElement("img");

          img.src = photoUrl;
          img.alt = `${fullName} profile photo`;

          target.appendChild(img);
        } else {
          target.textContent =
            fullName.trim().slice(0, 1).toUpperCase() ||
            "D";
        }
      }

      remove.disabled = busy || !photoUrl;
    }

    function setBusy(value) {
      busy = value;

      for (const control of form.elements) {
        control.disabled = value;
      }

      close.disabled = value;
      remove.disabled = value || !photoUrl;
    }

    async function api(options = {}) {
      const response = await fetch(
        "/api/driver/profile/photo",
        {
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
          ...options,
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(
          () => null
        );

        throw new Error(
          data?.message ||
            `Photo request failed (${response.status}).`
        );
      }

      return response;
    }

    async function loadPhoto() {
      const current = ++version;
      const response = await api();

      const blob =
        response.status === 204
          ? null
          : await response.blob();

      if (current !== version) return;

      const previous = photoUrl;

      photoUrl = blob
        ? URL.createObjectURL(blob)
        : null;

      paint();

      if (previous) {
        URL.revokeObjectURL(previous);
      }
    }

    async function preparePhoto(file) {
      if (
        !file ||
        ![
          "image/jpeg",
          "image/png",
          "image/webp",
        ].includes(file.type)
      ) {
        throw new Error(
          "Choose a JPEG, PNG or WebP image."
        );
      }

      if (file.size > 10 * 1024 * 1024) {
        throw new Error(
          "Choose a photo up to 10 MB."
        );
      }

      const bitmap = await createImageBitmap(file);

      try {
        if (
          !bitmap.width ||
          !bitmap.height ||
          bitmap.width * bitmap.height > 40000000
        ) {
          throw new Error(
            "Choose a photo with no more than 40 megapixels."
          );
        }

        const canvas = document.createElement("canvas");

        canvas.width = 384;
        canvas.height = 384;

        const context = canvas.getContext("2d");

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, 384, 384);

        const side = Math.min(
          bitmap.width,
          bitmap.height
        );

        context.drawImage(
          bitmap,
          (bitmap.width - side) / 2,
          (bitmap.height - side) / 2,
          side,
          side,
          0,
          0,
          384,
          384
        );

        const blob = await new Promise((resolve) => {
          canvas.toBlob(
            resolve,
            "image/jpeg",
            0.85
          );
        });

        if (
          !blob ||
          blob.size > 1024 * 1024
        ) {
          throw new Error(
            "Unable to prepare this photo. Choose another image."
          );
        }

        return blob;
      } finally {
        bitmap.close();
      }
    }

    document.addEventListener(
      "driver:data",
      (event) => {
        fullName =
          event.detail.profile.full_name || "Driver";

        paint();
      }
    );

    form.addEventListener(
      "submit",
      async (event) => {
        event.preventDefault();

        if (
          busy ||
          !form.reportValidity()
        ) {
          return;
        }

        const file = fileInput.files[0];

        setBusy(true);

        status.textContent =
          "Saving profile photo...";

        let saved = false;

        try {
          const blob = await preparePhoto(file);

          await api({
            method: "POST",
            headers: {
              "Content-Type": "image/jpeg",
            },
            body: blob,
          });

          saved = true;

          await loadPhoto();

          fileInput.value = "";

          status.textContent =
            "Profile photo saved.";
        } catch (error) {
          status.textContent = saved
            ? `Photo saved. Refresh to load it. ${error.message}`
            : error.message;
        } finally {
          setBusy(false);
        }
      }
    );

    remove.addEventListener(
      "click",
      async () => {
        if (busy || !photoUrl) return;

        setBusy(true);

        status.textContent =
          "Removing profile photo...";

        try {
          await api({
            method: "DELETE",
          });

          await loadPhoto();

          fileInput.value = "";

          status.textContent =
            "Profile photo removed.";
        } catch (error) {
          status.textContent = error.message;
        } finally {
          setBusy(false);
        }
      }
    );

    document.getElementById(
      "profile-dialog"
    ).addEventListener(
      "cancel",
      (event) => {
        if (busy) {
          event.preventDefault();
        }
      }
    );

    window.addEventListener("pagehide", () => {
      version++;

      if (photoUrl) {
        URL.revokeObjectURL(photoUrl);
      }
    });

    loadPhoto().catch((error) => {
      status.textContent = error.message;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      { once: true }
    );
  } else {
    init();
  }
})();
