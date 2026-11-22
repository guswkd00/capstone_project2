"use strict";

const express = require("express");

const MAX_BYTES = 1024 * 1024;

// Validate JPEG framing and declared dimensions.
function jpegDimensions(bytes) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length < 12 ||
    bytes.length > MAX_BYTES ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  ) {
    return null;
  }

  let offset = 2;

  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) {
      return null;
    }

    while (bytes[offset] === 0xff) {
      offset++;
    }

    const marker = bytes[offset++];

    if (marker === 0xda || marker === 0xd9) {
      return null;
    }

    if (
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      continue;
    }

    if (offset + 2 > bytes.length) {
      return null;
    }

    const size = bytes.readUInt16BE(offset);

    if (
      size < 2 ||
      offset + size > bytes.length
    ) {
      return null;
    }

    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (size < 8) {
        return null;
      }

      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);

      if (
        width < 16 ||
        height < 16 ||
        width > 2048 ||
        height > 2048
      ) {
        return null;
      }

      return {
        width,
        height,
      };
    }

    offset += size;
  }

  return null;
}

function createDriverPhotoRouter(pool) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");

    if (!req.user) {
      return res.status(401).json({
        message: "Please sign in.",
      });
    }

    if (
      req.user.role !== "driver" ||
      !req.driver
    ) {
      return res.status(403).json({
        message:
          "A linked Driver account is required.",
      });
    }

    next();
  });

  router.get("/profile/photo", async (req, res) => {
    try {
      const [rows] = await pool.execute(
        `SELECT p.image_data
         FROM driver_profile_photos p
         JOIN drivers d ON d.id = p.driver_id
         WHERE p.driver_id = ?
           AND d.user_id = ?`,
        [req.driver.id, req.user.id]
      );

      if (!rows.length) {
        return res.status(204).end();
      }

      res.type("image/jpeg");
      res.send(rows[0].image_data);
    } catch (error) {
      console.error(
        "Driver photo read failed:",
        error.code || error.name
      );

      res.status(500).json({
        message:
          "Unable to load your profile photo.",
      });
    }
  });

  router.post(
    "/profile/photo",

    express.raw({
      type: "image/jpeg",
      limit: MAX_BYTES,
    }),

    async (req, res) => {
      if (!req.is("image/jpeg")) {
        return res.status(415).json({
          message: "Upload a JPEG profile photo.",
        });
      }

      if (!jpegDimensions(req.body)) {
        return res.status(400).json({
          message:
            "Choose a valid JPEG photo up to 1 MB and 2048 by 2048 pixels.",
        });
      }

      try {
        const [result] = await pool.execute(
          `INSERT INTO driver_profile_photos (
             driver_id,
             content_type,
             image_data,
             byte_size
           )
           SELECT
             id,
             'image/jpeg',
             ?,
             ?
           FROM drivers
           WHERE id = ?
             AND user_id = ?
           ON DUPLICATE KEY UPDATE
             image_data = VALUES(image_data),
             byte_size = VALUES(byte_size),
             updated_at = CURRENT_TIMESTAMP`,
          [
            req.body,
            req.body.length,
            req.driver.id,
            req.user.id,
          ]
        );

        if (!result.affectedRows) {
          const [owner] = await pool.execute(
            `SELECT id
             FROM drivers
             WHERE id = ?
               AND user_id = ?`,
            [req.driver.id, req.user.id]
          );

          if (!owner.length) {
            return res.status(403).json({
              message:
                "Your Driver account is no longer linked.",
            });
          }
        }

        res.json({
          message: "Profile photo saved.",
        });
      } catch (error) {
        console.error(
          "Driver photo upload failed:",
          error.code || error.name
        );

        res.status(500).json({
          message:
            "Unable to save your profile photo.",
        });
      }
    }
  );

  router.delete(
    "/profile/photo",
    async (req, res) => {
      try {
        await pool.execute(
          `DELETE p
           FROM driver_profile_photos p
           JOIN drivers d ON d.id = p.driver_id
           WHERE p.driver_id = ?
             AND d.user_id = ?`,
          [req.driver.id, req.user.id]
        );

        res.json({
          message: "Profile photo removed.",
        });
      } catch (error) {
        console.error(
          "Driver photo removal failed:",
          error.code || error.name
        );

        res.status(500).json({
          message:
            "Unable to remove your profile photo.",
        });
      }
    }
  );

  router.use((error, req, res, next) => {
    if (error.type === "entity.too.large") {
      return res.status(413).json({
        message:
          "Profile photo must be 1 MB or smaller.",
      });
    }

    next(error);
  });

  return router;
}

module.exports = {
  createDriverPhotoRouter,
  jpegDimensions,
};
