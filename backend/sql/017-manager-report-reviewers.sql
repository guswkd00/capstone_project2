CREATE TABLE IF NOT EXISTS shopeefood_db.manager_report_reviewers (
  user_id INT UNSIGNED NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  granted_by INT UNSIGNED DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (user_id),

  CONSTRAINT fk_report_reviewer_user
    FOREIGN KEY (user_id)
    REFERENCES shopeefood_db.users(id),

  CONSTRAINT fk_report_reviewer_grantor
    FOREIGN KEY (granted_by)
    REFERENCES shopeefood_db.users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
