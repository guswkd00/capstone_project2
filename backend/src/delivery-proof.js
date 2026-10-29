const express = require("express");
const { pool } = require("./db");

const router = express.Router();

function imageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;

  if (
    buffer.length > 3 &&
    buffer[0] === 255 &&
    buffer[1] === 216 &&
    buffer[2] === 255
  ) {
    return "image/jpeg";
  }

  const pngSignature = Buffer.from([
    137, 80, 78, 71, 13, 10, 26, 10
  ]);

  if (
    buffer.length > 8 &&
    buffer.subarray(0, 8).equals(pngSignature)
  ) {
    return "image/png";
  }

  if (
    buffer.length > 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

router.post(
  "/orders/:id/proof",

  express.raw({
    type: ["image/jpeg", "image/png", "image/webp"],
    limit: "5mb"
  }),

  async (req, res) => {
    const orderId = Number(req.params.id);
    const contentType = imageType(req.body);

    if (!req.driver || req.user?.role !== "driver") {
      return res.status(403).json({
        message: "A linked driver account is required."
      });
    }

    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
      return res.status(400).json({
        message: "Invalid order ID."
      });
    }

    if (!contentType) {
      return res.status(400).json({
        message: "Upload a JPEG, PNG or WebP image."
      });
    }

    let connection;

    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();

      const [orders] = await connection.execute(
        `
          SELECT driver_id, status, picked_up_at
          FROM orders
          WHERE id = ?
          FOR UPDATE
        `,
        [orderId]
      );

      if (
        !orders.length ||
        Number(orders[0].driver_id) !== Number(req.driver.id)
      ) {
        await connection.rollback();

        return res.status(403).json({
          message: "This is not your assigned delivery."
        });
      }

      const order = orders[0];

      if (
        order.status !== "delivering" ||
        !order.picked_up_at
      ) {
        await connection.rollback();

        return res.status(409).json({
          message:
            "Confirm food pickup before uploading delivery proof."
        });
      }

      await connection.execute(
        `
          INSERT INTO order_delivery_proofs (
            order_id,
            driver_id,
            content_type,
            image_data,
            byte_size
          )
          VALUES (?, ?, ?, ?, ?)

          ON DUPLICATE KEY UPDATE
            driver_id = VALUES(driver_id),
            content_type = VALUES(content_type),
            image_data = VALUES(image_data),
            byte_size = VALUES(byte_size),
            uploaded_at = CURRENT_TIMESTAMP
        `,
        [
          orderId,
          req.driver.id,
          contentType,
          req.body,
          req.body.length
        ]
      );

      await connection.commit();

      res.set("Cache-Control", "no-store");

      res.json({
        message: "Delivery photo saved."
      });
    } catch (error) {
      if (connection) await connection.rollback();

      console.error(
        "Delivery photo upload failed:",
        error.code || error.name
      );

      res.status(500).json({
        message: "Unable to save delivery photo."
      });
    } finally {
      if (connection) connection.release();
    }
  }
);

router.use((error, req, res, next) => {
  if (error.type === "entity.too.large") {
    return res.status(413).json({
      message: "Photo must be 5 MB or smaller after compression."
    });
  }

  next(error);
});

module.exports = router;
