"use strict";

const express = require("express");

const {
  LIMITS,
  REPORT_TYPES,
  REPORT_STATES,
  httpError,
  parseId,
  parseVersion,
  validateReportInput,
  validateAttachment
} = require("./manager-report-policy");

const {
  validateDocument
} = require("./manager-report-document");

function createManagerReportsRouter(pool) {
  const router = express.Router();

  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");

    if (!req.user) {
      return res.status(401).json({
        message: "Sign in first."
      });
    }

    if (req.user.role !== "manager") {
      return res.status(403).json({
        message: "Manager access is required."
      });
    }

    next();
  });

  function handle(task) {
    return async (req, res) => {
      try {
        await task(req, res);
      } catch (error) {
        sendError(error, res);
      }
    };
  }

  function sendError(error, res) {
    const allowed = [
      400,
      403,
      404,
      409,
      413,
      415,
      503
    ];

    const status = allowed.includes(
      error.status
    )
      ? error.status
      : 503;

    if (status === 503) {
      console.error(
        "Manager reports failed:",
        error.code || error.name
      );
    }

    res.status(status).json({
      message: status === 503
        ? "Reports are unavailable. Please try again."
        : error.message
    });
  }

  async function transaction(task) {
    const db = await pool.getConnection();

    try {
      await db.beginTransaction();

      const result = await task(db);

      await db.commit();

      return result;
    } catch (error) {
      try {
        await db.rollback();
      } catch {
        // Preserve the original error.
      }

      throw error;
    } finally {
      db.release();
    }
  }

  function jsonValue(value) {
    if (value == null) return null;

    return typeof value === "string"
      ? JSON.parse(value)
      : value;
  }

  function jsonParameter(value) {
    return value == null
      ? null
      : JSON.stringify(value);
  }

  async function loadReport(
    db,
    managerId,
    reportId,
    lock = false
  ) {
    const [rows] = await db.execute(
      `SELECT
         CAST(id AS CHAR) AS id,
         title,
         report_type,
         DATE_FORMAT(
           period_start,
           '%Y-%m-%d'
         ) AS period_start,
         DATE_FORMAT(
           period_end,
           '%Y-%m-%d'
         ) AS period_end,
         content,
         editor_document,
         page_settings,
         data_snapshot,
         status,
         version,
         created_at,
         updated_at,
         submitted_at
       FROM manager_reports
       WHERE id = ?
         AND manager_id = ?
       ${lock ? "FOR UPDATE" : ""}`,
      [
        reportId,
        managerId
      ]
    );

    if (!rows.length) {
      throw httpError(
        404,
        "Report not found."
      );
    }

    const report = rows[0];

    report.data_snapshot = jsonValue(
      report.data_snapshot
    );

    report.editor_document = jsonValue(
      report.editor_document
    );

    report.page_settings = jsonValue(
      report.page_settings
    );

    if (report.editor_document !== null) {
      const rich = validateDocument(
        report.editor_document
      );

      // A plain-text generator may have replaced the content.
      // Do not return an outdated formatted document.
      if (rich.text !== report.content) {
        report.editor_document = null;
      }
    }

    return report;
  }

  async function loadFiles(db, reportId) {
    const [rows] = await db.execute(
      `SELECT
         CAST(id AS CHAR) AS id,
         original_name,
         content_type,
         byte_size,
         created_at
       FROM manager_report_files
       WHERE report_id = ?
       ORDER BY id`,
      [reportId]
    );

    return rows;
  }

  async function reportDetails(
    db,
    managerId,
    reportId
  ) {
    const report = await loadReport(
      db,
      managerId,
      reportId
    );

    const files = await loadFiles(
      db,
      reportId
    );

    return {
      ...report,
      files
    };
  }

  function requireEditable(
    report,
    expectedVersion
  ) {
    if (report.status !== "draft") {
      throw httpError(
        409,
        "Submitted reports are read-only."
      );
    }

    if (
      Number(report.version) !==
      expectedVersion
    ) {
      throw httpError(
        409,
        "This report changed in another tab. Reload it before continuing."
      );
    }
  }

  async function lastInsertedId(db) {
    const [[row]] = await db.query(
      `SELECT CAST(
         LAST_INSERT_ID() AS CHAR
       ) AS id`
    );

    return row.id;
  }

  function uploadVersion(req) {
    return parseVersion(
      Number(
        req.get("X-Report-Version")
      )
    );
  }

  function downloadFilename(name) {
    return encodeURIComponent(name).replace(
      /[!'()*]/g,
      character =>
        "%" +
        character.charCodeAt(0)
          .toString(16)
          .toUpperCase()
    );
  }

  async function checkImageAttachments(
    db,
    managerId,
    reportId,
    document
  ) {
    if (document === null) return;

    const rich = validateDocument(
      document
    );

    const ids = rich.attachment_ids;

    if (!ids.length) return;

    if (
      ids.length > LIMITS.filesPerReport
    ) {
      throw httpError(
        400,
        "The document references too many image attachments."
      );
    }

    const placeholders = ids.map(
      () => "?"
    ).join(", ");

    const [files] = await db.execute(
      `SELECT
         CAST(f.id AS CHAR) AS id,
         f.content_type
       FROM manager_report_files f
       JOIN manager_reports r
         ON r.id = f.report_id
       WHERE r.id = ?
         AND r.manager_id = ?
         AND f.id IN (${placeholders})`,
      [
        reportId,
        managerId,
        ...ids
      ]
    );

    if (
      files.length !== ids.length ||
      files.some(file =>
        ![
          "image/png",
          "image/jpeg"
        ].includes(file.content_type)
      )
    ) {
      throw httpError(
        400,
        "Images must use PNG or JPG attachments uploaded to this report."
      );
    }
  }

  function nextDocument(input, report) {
    if (
      Object.hasOwn(
        input,
        "editor_document"
      )
    ) {
      return input.editor_document;
    }

    // Preserve formatting when a legacy client only changes metadata.
    if (
      input.content === report.content
    ) {
      return report.editor_document;
    }

    return null;
  }

  function nextPageSettings(
    input,
    report
  ) {
    return Object.hasOwn(
      input,
      "page_settings"
    )
      ? input.page_settings
      : report.page_settings;
  }

  // List reports owned by the current Manager.
  router.get("/", handle(async (req, res) => {
    const status =
      req.query.status || "all";

    const type =
      req.query.type || "all";

    const search =
      req.query.q || "";

    if (
      !["all", ...REPORT_STATES].includes(
        status
      ) ||
      !["all", ...REPORT_TYPES].includes(
        type
      ) ||
      typeof search !== "string" ||
      search.length > 100
    ) {
      throw httpError(
        400,
        "Invalid report filters."
      );
    }

    const before =
      req.query.before === undefined
        ? null
        : parseId(req.query.before);

    const conditions = [
      "r.manager_id = ?"
    ];

    const values = [
      req.user.id
    ];

    if (status !== "all") {
      conditions.push(
        "r.status = ?"
      );

      values.push(status);
    }

    if (type !== "all") {
      conditions.push(
        "r.report_type = ?"
      );

      values.push(type);
    }

    if (search.trim()) {
      conditions.push(
        "LOCATE(?, r.title) > 0"
      );

      values.push(search.trim());
    }

    if (before) {
      conditions.push(
        "r.id < ?"
      );

      values.push(before);
    }

    const [rows] = await pool.execute(
      `SELECT
         CAST(r.id AS CHAR) AS id,
         r.title,
         r.report_type,
         DATE_FORMAT(
           r.period_start,
           '%Y-%m-%d'
         ) AS period_start,
         DATE_FORMAT(
           r.period_end,
           '%Y-%m-%d'
         ) AS period_end,
         r.status,
         r.version,
         r.created_at,
         r.updated_at,
         r.submitted_at,
         (
           SELECT COUNT(*)
           FROM manager_report_files f
           WHERE f.report_id = r.id
         ) AS attachment_count,
         (
           r.data_snapshot IS NOT NULL
         ) AS has_data_snapshot
       FROM manager_reports r
       WHERE ${conditions.join(" AND ")}
       ORDER BY r.id DESC
       LIMIT ${LIMITS.listSize + 1}`,
      values
    );

    res.json({
      data: rows.slice(
        0,
        LIMITS.listSize
      ),

      next_before:
        rows.length > LIMITS.listSize
          ? rows[LIMITS.listSize - 1].id
          : null
    });
  }));

  // Create a new draft.
  router.post("/", handle(async (req, res) => {
    const input = validateReportInput(
      req.body
    );

    if (
      input.image_attachment_ids?.length
    ) {
      throw httpError(
        400,
        "Save the draft and upload its images before inserting them into the document."
      );
    }

    const data = await transaction(
      async db => {
        await db.execute(
          `INSERT INTO manager_reports (
             manager_id,
             title,
             report_type,
             period_start,
             period_end,
             content,
             editor_document,
             page_settings,
             status
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, 'draft'
           )`,
          [
            req.user.id,
            input.title,
            input.report_type,
            input.period_start,
            input.period_end,
            input.content,
            jsonParameter(
              input.editor_document
            ),
            jsonParameter(
              input.page_settings
            )
          ]
        );

        const reportId =
          await lastInsertedId(db);

        return reportDetails(
          db,
          req.user.id,
          reportId
        );
      }
    );

    res.status(201).json({
      data,
      message: "Draft created."
    });
  }));

  // Read an owned report.
  router.get(
    "/:id",
    handle(async (req, res) => {
      const reportId = parseId(
        req.params.id
      );

      const data = await transaction(
        db => reportDetails(
          db,
          req.user.id,
          reportId
        )
      );

      res.json({ data });
    })
  );

  // Save a draft and its formatting.
  router.put(
    "/:id",
    handle(async (req, res) => {
      const reportId = parseId(
        req.params.id
      );

      const input = validateReportInput(
        req.body,
        {
          requireVersion: true
        }
      );

      const data = await transaction(
        async db => {
          const report = await loadReport(
            db,
            req.user.id,
            reportId,
            true
          );

          requireEditable(
            report,
            input.version
          );

          const document = nextDocument(
            input,
            report
          );

          const pageSettings =
            nextPageSettings(
              input,
              report
            );

          await checkImageAttachments(
            db,
            req.user.id,
            reportId,
            document
          );

          const contextChanged =
            report.report_type !==
              input.report_type ||
            report.period_start !==
              input.period_start ||
            report.period_end !==
              input.period_end;

          await db.execute(
            `UPDATE manager_reports
             SET
               title = ?,
               report_type = ?,
               period_start = ?,
               period_end = ?,
               content = ?,
               editor_document = ?,
               page_settings = ?,
               data_snapshot = CASE
                 WHEN ? = 1 THEN NULL
                 ELSE data_snapshot
               END,
               version = version + 1
             WHERE id = ?
               AND manager_id = ?`,
            [
              input.title,
              input.report_type,
              input.period_start,
              input.period_end,
              input.content,
              jsonParameter(document),
              jsonParameter(pageSettings),
              contextChanged ? 1 : 0,
              reportId,
              req.user.id
            ]
          );

          return reportDetails(
            db,
            req.user.id,
            reportId
          );
        }
      );

      res.json({
        data,
        message: "Draft saved."
      });
    })
  );

  // Submit a draft.
  router.post(
    "/:id/submit",
    handle(async (req, res) => {
      const reportId = parseId(
        req.params.id
      );

      const version = parseVersion(
        req.body?.version
      );

      const data = await transaction(
        async db => {
          const report = await loadReport(
            db,
            req.user.id,
            reportId,
            true
          );

          if (
            report.status === "submitted"
          ) {
            return reportDetails(
              db,
              req.user.id,
              reportId
            );
          }

          requireEditable(
            report,
            version
          );

          await checkImageAttachments(
            db,
            req.user.id,
            reportId,
            report.editor_document
          );

          const files = await loadFiles(
            db,
            reportId
          );

          if (
            !report.content.trim() &&
            files.length === 0
          ) {
            throw httpError(
              400,
              "Add report content or attach a file before submitting."
            );
          }

          await db.execute(
            `UPDATE manager_reports
             SET
               status = 'submitted',
               submitted_at = UTC_TIMESTAMP(),
               version = version + 1
             WHERE id = ?
               AND manager_id = ?`,
            [
              reportId,
              req.user.id
            ]
          );

          return reportDetails(
            db,
            req.user.id,
            reportId
          );
        }
      );

      res.json({
        data,
        message: "Report submitted."
      });
    })
  );

  // Delete an owned draft.
  router.delete(
    "/:id",
    handle(async (req, res) => {
      const reportId = parseId(
        req.params.id
      );

      const version = parseVersion(
        req.body?.version
      );

      await transaction(async db => {
        const report = await loadReport(
          db,
          req.user.id,
          reportId,
          true
        );

        requireEditable(
          report,
          version
        );

        await db.execute(
          `DELETE FROM manager_reports
           WHERE id = ?
             AND manager_id = ?`,
          [
            reportId,
            req.user.id
          ]
        );
      });

      res.json({
        message: "Draft deleted."
      });
    })
  );

  const uploadBody = express.raw({
    type: () => true,
    limit: LIMITS.fileBytes
  });

  // Upload a file to an owned draft.
  router.post(
    "/:id/files",
    uploadBody,
    handle(async (req, res) => {
      const reportId = parseId(
        req.params.id
      );

      const version = uploadVersion(req);

      const file = validateAttachment(
        req.body,
        req.get("Content-Type"),
        req.query.name
      );

      const result = await transaction(
        async db => {
          const report = await loadReport(
            db,
            req.user.id,
            reportId,
            true
          );

          requireEditable(
            report,
            version
          );

          const [[count]] = await db.execute(
            `SELECT COUNT(*) AS total
             FROM manager_report_files
             WHERE report_id = ?`,
            [reportId]
          );

          if (
            Number(count.total) >=
            LIMITS.filesPerReport
          ) {
            throw httpError(
              400,
              `A report can contain up to ${LIMITS.filesPerReport} attachments.`
            );
          }

          await db.execute(
            `INSERT INTO manager_report_files (
               report_id,
               original_name,
               content_type,
               byte_size,
               file_data
             ) VALUES (?, ?, ?, ?, ?)`,
            [
              reportId,
              file.original_name,
              file.content_type,
              file.byte_size,
              req.body
            ]
          );

          const fileId =
            await lastInsertedId(db);

          await db.execute(
            `UPDATE manager_reports
             SET version = version + 1
             WHERE id = ?
               AND manager_id = ?`,
            [
              reportId,
              req.user.id
            ]
          );

          return {
            data: {
              id: fileId,
              ...file
            },

            report_version:
              Number(report.version) + 1
          };
        }
      );

      res.status(201).json({
        ...result,
        message: "Attachment uploaded."
      });
    })
  );

  // Download an attachment from an owned report.
  router.get(
    "/:id/files/:fileId",
    handle(async (req, res) => {
      const reportId = parseId(
        req.params.id
      );

      const fileId = parseId(
        req.params.fileId
      );

      const [rows] = await pool.execute(
        `SELECT
           f.original_name,
           f.content_type,
           f.byte_size,
           f.file_data
         FROM manager_report_files f
         JOIN manager_reports r
           ON r.id = f.report_id
         WHERE f.id = ?
           AND r.id = ?
           AND r.manager_id = ?`,
        [
          fileId,
          reportId,
          req.user.id
        ]
      );

      if (!rows.length) {
        throw httpError(
          404,
          "Attachment not found."
        );
      }

      const file = rows[0];

      const extensions = {
        "application/pdf": ".pdf",
        "image/png": ".png",
        "image/jpeg": ".jpg"
      };

      const extension =
        extensions[file.content_type] || "";

      res.set(
        "Content-Type",
        extension
          ? file.content_type
          : "application/octet-stream"
      );

      res.set(
        "Content-Disposition",
        `attachment; filename="report-file${extension}"; ` +
        `filename*=UTF-8''${downloadFilename(file.original_name)}`
      );

      res.set(
        "Content-Security-Policy",
        "default-src 'none'; sandbox"
      );

      res.set(
        "Content-Length",
        String(file.byte_size)
      );

      res.send(file.file_data);
    })
  );

  // Remove an attachment only if it is not used by the document.
  router.delete(
    "/:id/files/:fileId",
    handle(async (req, res) => {
      const reportId = parseId(
        req.params.id
      );

      const fileId = parseId(
        req.params.fileId
      );

      const version = parseVersion(
        req.body?.version
      );

      const result = await transaction(
        async db => {
          const report = await loadReport(
            db,
            req.user.id,
            reportId,
            true
          );

          requireEditable(
            report,
            version
          );

          if (
            report.editor_document !== null
          ) {
            const rich =
              validateDocument(
                report.editor_document
              );

            if (
              rich.attachment_ids.includes(
                fileId
              )
            ) {
              throw httpError(
                400,
                "Remove this image from the editor and save the draft before deleting its attachment."
              );
            }
          }

          const [deleted] = await db.execute(
            `DELETE FROM manager_report_files
             WHERE id = ?
               AND report_id = ?`,
            [
              fileId,
              reportId
            ]
          );

          if (!deleted.affectedRows) {
            throw httpError(
              404,
              "Attachment not found."
            );
          }

          await db.execute(
            `UPDATE manager_reports
             SET version = version + 1
             WHERE id = ?
               AND manager_id = ?`,
            [
              reportId,
              req.user.id
            ]
          );

          return {
            report_version:
              Number(report.version) + 1
          };
        }
      );

      res.json({
        ...result,
        message: "Attachment removed."
      });
    })
  );

  router.use(
    (error, req, res, next) => {
      if (res.headersSent) {
        return next(error);
      }

      if (
        error.type === "entity.too.large" ||
        error.status === 413
      ) {
        return res.status(413).json({
          message: "Choose a file up to 5 MB."
        });
      }

      sendError(error, res);
    }
  );

  return router;
}

module.exports = {
  createManagerReportsRouter
};
