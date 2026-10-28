CREATE TABLE IF NOT EXISTS shopeefood_db.manager_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  manager_id INT UNSIGNED NOT NULL,
  event_key VARCHAR(190) NOT NULL,
  notification_type VARCHAR(40) NOT NULL,
  title VARCHAR(160) NOT NULL,
  message VARCHAR(1000) NOT NULL,
  target_url VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP NULL DEFAULT NULL,

  UNIQUE KEY uq_manager_notification_event (
    manager_id,
    event_key
  ),

  KEY idx_manager_notification_unread (
    manager_id,
    read_at,
    id
  ),

  CONSTRAINT fk_manager_notification_user
    FOREIGN KEY (manager_id)
    REFERENCES shopeefood_db.users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
