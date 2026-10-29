-- Apply after 006-tidb-schema.sql and 007-delivery-operations.sql.
-- Additive setup. Existing orders and balances are preserved.
-- In SQL editors, execute each CREATE TABLE statement separately.

USE shopeefood_db;

CREATE TABLE IF NOT EXISTS driver_wallets (
  driver_id INT UNSIGNED NOT NULL PRIMARY KEY,
  cash_balance BIGINT NOT NULL DEFAULT 0,
  reserved_cash BIGINT NOT NULL DEFAULT 0,
  deposit_balance BIGINT NOT NULL DEFAULT 0,
  points INT UNSIGNED NOT NULL DEFAULT 0,
  max_delivery_km DECIMAL(6,2) NOT NULL DEFAULT 10,

  CONSTRAINT fk_dw_driver
    FOREIGN KEY (driver_id)
    REFERENCES drivers(id),

  CHECK (
    cash_balance >= reserved_cash
    AND reserved_cash >= 0
    AND deposit_balance >= 0
  )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS driver_wallet_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  driver_id INT UNSIGNED NOT NULL,
  event_key VARCHAR(100) NOT NULL,
  entry_type VARCHAR(30) NOT NULL,
  cash_delta BIGINT NOT NULL DEFAULT 0,
  deposit_delta BIGINT NOT NULL DEFAULT 0,
  points_delta INT NOT NULL DEFAULT 0,
  description VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_dw_event (driver_id, event_key),
  KEY idx_dw_history (driver_id, id),

  CONSTRAINT fk_dwe_driver
    FOREIGN KEY (driver_id)
    REFERENCES drivers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS driver_wallet_requests (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  driver_id INT UNSIGNED NOT NULL,
  request_key CHAR(36) NOT NULL,
  request_type ENUM('withdrawal','topup') NOT NULL,
  amount BIGINT NOT NULL,

  status ENUM('pending','approved','rejected')
    NOT NULL DEFAULT 'pending',

  reviewed_by INT UNSIGNED DEFAULT NULL,
  reference VARCHAR(150) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME DEFAULT NULL,

  UNIQUE KEY uq_dw_request (driver_id, request_key),
  KEY idx_dw_pending (status, id),

  CONSTRAINT fk_dwr_driver
    FOREIGN KEY (driver_id)
    REFERENCES drivers(id),

  CONSTRAINT fk_dwr_reviewer
    FOREIGN KEY (reviewed_by)
    REFERENCES users(id),

  CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS driver_order_messages (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id INT UNSIGNED NOT NULL,
  sender_id INT UNSIGNED NOT NULL,
  sender_role ENUM('driver','manager') NOT NULL,
  message_key CHAR(36) NOT NULL,
  message_text VARCHAR(1000) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_dom_message (sender_id, message_key),
  KEY idx_dom_order (order_id, id),

  CONSTRAINT fk_dom_order
    FOREIGN KEY (order_id)
    REFERENCES orders(id),

  CONSTRAINT fk_dom_sender
    FOREIGN KEY (sender_id)
    REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
