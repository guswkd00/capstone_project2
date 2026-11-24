"use strict";

const {
  createToken,
  hashToken,
} = require("./security");

function validSharingToken(value) {
  return (
    typeof value === "string" &&
    /^[a-f0-9]{64}$/.test(value)
  );
}

function sharingHandler(db) {
  return async (req, res, next) => {
    if (typeof req.body?.enabled !== "boolean") {
      return res.status(400).json({
        message: "enabled must be a boolean.",
      });
    }

    try {
      if (req.body.enabled) {
        const token = createToken();

        await db.execute(
          `
            UPDATE drivers
            SET
              gps_sharing_enabled = 1,
              gps_session_token = ?
            WHERE id = ?
              AND user_id = ?
          `,
          [
            hashToken(token),
            req.driver.id,
            req.user.id,
          ]
        );

        res.set("Cache-Control", "no-store");

        return res.json({
          sharing_token: token,
          enabled: true,
        });
      }

      if (!validSharingToken(req.body.sharing_token)) {
        return res.status(400).json({
          message:
            "A sharing token is required to stop GPS.",
        });
      }

      await db.execute(
        `
          UPDATE drivers
          SET
            gps_sharing_enabled = 0,
            gps_session_token = NULL
          WHERE id = ?
            AND user_id = ?
            AND gps_session_token = ?
        `,
        [
          req.driver.id,
          req.user.id,
          hashToken(req.body.sharing_token),
        ]
      );

      return res.json({
        enabled: false,
      });
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  sharingHandler,
  validSharingToken,
};
