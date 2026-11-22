"use strict";

const {
  normalizeExternalId,
} = require("../src/order-import-policy");

const districts = [
  ["HN-HOAN-KIEM", "Hoàn Kiếm", 21.0285, 105.8542],
  ["HN-BA-DINH", "Ba Đình", 21.0359, 105.8216],
  ["HN-DONG-DA", "Đống Đa", 21.0181, 105.8299],
  ["HN-HAI-BA-TRUNG", "Hai Bà Trưng", 21.0058, 105.8572],
  ["HN-CAU-GIAY", "Cầu Giấy", 21.0362, 105.7906],
  ["HN-THANH-XUAN", "Thanh Xuân", 20.9947, 105.7997],
  ["HN-TAY-HO", "Tây Hồ", 21.0694, 105.8195],
  ["HN-NAM-TU-LIEM", "Nam Từ Liêm", 21.0179, 105.7611],
  ["HN-BAC-TU-LIEM", "Bắc Từ Liêm", 21.0744, 105.7654],
  ["HN-HOANG-MAI", "Hoàng Mai", 20.9745, 105.8549],
  ["HN-LONG-BIEN", "Long Biên", 21.038, 105.8929],
  ["HN-HA-DONG", "Hà Đông", 20.9714, 105.7788],
];

async function migrate(db) {
  const [columns] = await db.query(
    "SHOW COLUMNS FROM orders"
  );

  const normalizedRows = [];

  // Check existing identities before any schema or data changes.
  if (
    columns.some(
      column => column.Field === "external_order_id"
    )
  ) {
    const [rows] = await db.query(
      `SELECT id, external_order_id
       FROM orders
       WHERE external_order_id IS NOT NULL`
    );

    const identities = new Map();

    for (const row of rows) {
      const canonical = normalizeExternalId(
        row.external_order_id
      );

      normalizedRows.push({
        id: row.id,
        canonical,
      });

      identities.set(
        canonical,
        [
          ...(identities.get(canonical) || []),
          row.id,
        ]
      );
    }

    const duplicates = [...identities].filter(
      ([, ids]) => ids.length > 1
    );

    if (duplicates.length) {
      throw new Error(
        "Duplicate external order IDs; " +
        "resolve before migration: " +
        JSON.stringify(duplicates)
      );
    }
  }

  async function column(table, name, definition) {
    const [fields] = await db.query(
      `SHOW COLUMNS FROM ${table}`
    );

    if (!fields.some(field => field.Field === name)) {
      await db.query(
        `ALTER TABLE ${table}
         ADD COLUMN ${name} ${definition}`
      );
    }
  }

  async function index(table, name, sql) {
    const [indexes] = await db.query(
      `SHOW INDEX FROM ${table}`
    );

    const existing = indexes.filter(
      item => item.Key_name === name
    );

    const expectedColumn =
      table === "orders"
        ? "external_order_id"
        : "code";

    const invalid =
      existing.length > 0 &&
      (
        existing.some(
          item =>
            Number(item.Non_unique) !== 0 ||
            item.Sub_part != null
        ) ||
        existing.length !== 1 ||
        existing[0].Column_name !== expectedColumn
      );

    if (invalid) {
      throw new Error(
        `Unexpected index definition: ${name}`
      );
    }

    if (!existing.length) {
      await db.query(sql);
    }
  }

  await column(
    "zones",
    "code",
    "VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NULL"
  );

  await index(
    "zones",
    "uq_zones_code",
    "ALTER TABLE zones ADD UNIQUE KEY uq_zones_code (code)"
  );

  await column(
    "drivers",
    "gps_sharing_enabled",
    "TINYINT(1) NOT NULL DEFAULT 0"
  );

  await column(
    "drivers",
    "gps_session_token",
    "CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL"
  );

  await column(
    "drivers",
    "gps_location_token",
    "CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL"
  );

  await column(
    "orders",
    "external_order_id",
    "VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL"
  );

  await column(
    "orders",
    "import_source",
    "VARCHAR(64) NOT NULL DEFAULT 'manual'"
  );

  // Normalize only after the duplicate preflight passes.
  for (const row of normalizedRows) {
    await db.execute(
      `UPDATE orders
       SET external_order_id = ?
       WHERE id = ?`,
      [row.canonical, row.id]
    );
  }

  await index(
    "orders",
    "uq_orders_external_order_id",
    `ALTER TABLE orders
     ADD UNIQUE KEY uq_orders_external_order_id
     (external_order_id)`
  );

  // Preserve existing zone IDs, coordinates and relationships.
  for (const [code, name, latitude, longitude] of districts) {
    const [existing] = await db.execute(
      `SELECT id, code, name
       FROM zones
       WHERE code = ? OR name = ?`,
      [code, name]
    );

    if (
      existing.length > 1 ||
      (
        existing[0]?.code &&
        existing[0].code !== code
      )
    ) {
      throw new Error(
        `Zone code/name conflict: ${code} / ${name}; ` +
        "existing links were not changed."
      );
    }

    if (existing.length) {
      if (!existing[0].code) {
        await db.execute(
          `UPDATE zones
           SET code = ?
           WHERE id = ? AND code IS NULL`,
          [code, existing[0].id]
        );
      }
    } else {
      await db.execute(
        `INSERT INTO zones (
          code,
          name,
          latitude,
          longitude,
          active
        )
        VALUES (?, ?, ?, ?, 1)`,
        [code, name, latitude, longitude]
      );
    }
  }
}

module.exports = {
  migrate,
  districts,
};
