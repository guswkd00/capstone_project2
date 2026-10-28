CREATE TABLE IF NOT EXISTS shopeefood_db.manager_reports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  manager_id INT UNSIGNED NOT NULL,

  title VARCHAR(160) NOT NULL,
  report_type ENUM(
    'delivery',
    'cod',
    'maintenance',
    'expense',
    'incident',
    'general'
  ) NOT NULL DEFAULT 'general',

  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  content MEDIUMTEXT NOT NULL,
  data_snapshot JSON DEFAULT NULL,

  status ENUM('draft', 'submitted')
    NOT NULL DEFAULT 'draft',

  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  submitted_at DATETIME DEFAULT NULL,

  PRIMARY KEY (id),

  KEY idx_manager_reports_owner (
    manager_id,
    status,
    id
  ),

  CONSTRAINT fk_manager_report_owner
    FOREIGN KEY (manager_id)
    REFERENCES shopeefood_db.users(id),

  CONSTRAINT chk_manager_report_period
    CHECK (period_end >= period_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
