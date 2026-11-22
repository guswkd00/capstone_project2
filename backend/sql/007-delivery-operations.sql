-- Run after 006-tidb-schema.sql.
-- Additive setup: existing tables and data are preserved.

CREATE TABLE IF NOT EXISTS shopeefood_db.order_delivery_proofs (
  order_id INT UNSIGNED NOT NULL,
  driver_id INT UNSIGNED NOT NULL,
  content_type VARCHAR(32) NOT NULL,
  image_data MEDIUMBLOB NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (order_id),
  KEY idx_delivery_proof_driver (driver_id),

  CONSTRAINT fk_delivery_proof_order
    FOREIGN KEY (order_id)
    REFERENCES shopeefood_db.orders(id),

  CONSTRAINT fk_delivery_proof_driver
    FOREIGN KEY (driver_id)
    REFERENCES shopeefood_db.drivers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS shopeefood_db.order_cod_settlements (
  order_id INT UNSIGNED NOT NULL,
  driver_id INT UNSIGNED NOT NULL,
  received_amount DECIMAL(12, 2) NOT NULL,
  confirmed_by INT UNSIGNED NOT NULL,
  confirmed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (order_id),
  KEY idx_cod_settlement_driver (driver_id),

  CONSTRAINT fk_cod_settlement_order
    FOREIGN KEY (order_id)
    REFERENCES shopeefood_db.orders(id),

  CONSTRAINT fk_cod_settlement_driver
    FOREIGN KEY (driver_id)
    REFERENCES shopeefood_db.drivers(id),

  CONSTRAINT fk_cod_settlement_manager
    FOREIGN KEY (confirmed_by)
    REFERENCES shopeefood_db.users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS shopeefood_db.vehicle_expenses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  vehicle_id INT UNSIGNED NOT NULL,
  expense_type ENUM('fuel', 'maintenance', 'other') NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  expense_date DATE NOT NULL,
  description VARCHAR(500) NOT NULL,
  created_by INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_vehicle_expense_date (vehicle_id, expense_date),
  KEY idx_expense_date (expense_date),

  CONSTRAINT fk_vehicle_expense_vehicle
    FOREIGN KEY (vehicle_id)
    REFERENCES shopeefood_db.vehicles(id),

  CONSTRAINT fk_vehicle_expense_creator
    FOREIGN KEY (created_by)
    REFERENCES shopeefood_db.users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;
