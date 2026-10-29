CREATE TABLE IF NOT EXISTS shopeefood_db.manager_report_files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  report_id BIGINT UNSIGNED NOT NULL,

  original_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  byte_size INT UNSIGNED NOT NULL,
  file_data MEDIUMBLOB NOT NULL,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),

  KEY idx_manager_report_files (
    report_id,
    id
  ),

  CONSTRAINT fk_manager_report_file
    FOREIGN KEY (report_id)
    REFERENCES shopeefood_db.manager_reports(id)
    ON DELETE CASCADE,

  CONSTRAINT chk_manager_report_file_size
    CHECK (
      byte_size > 0
      AND byte_size <= 5242880
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
