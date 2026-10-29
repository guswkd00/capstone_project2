window.prepareDeliveryPhoto = async function (file) {
  if (!file || !file.size) {
    throw new Error("Choose a delivery photo.");
  }

  if (file.size > 15 * 1024 * 1024) {
    throw new Error("Choose a photo smaller than 15 MB.");
  }

  let image;

  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error(
      "Unable to read this photo. Use JPEG, PNG or WebP."
    );
  }

  try {
    const scale = Math.min(
      1,
      1280 / Math.max(image.width, image.height)
    );

    const canvas = document.createElement("canvas");

    canvas.width = Math.max(
      1,
      Math.round(image.width * scale)
    );

    canvas.height = Math.max(
      1,
      Math.round(image.height * scale)
    );

    const context = canvas.getContext("2d");

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.drawImage(
      image,
      0,
      0,
      canvas.width,
      canvas.height
    );

    for (const quality of [0.82, 0.65, 0.45, 0.25]) {
      const blob = await new Promise(resolve => {
        canvas.toBlob(resolve, "image/jpeg", quality);
      });

      if (blob && blob.size <= 5 * 1024 * 1024) {
        return blob;
      }
    }

    throw new Error(
      "Photo is too large. Choose a smaller photo."
    );
  } finally {
    image.close();
  }
};
