CREATE TABLE IF NOT EXISTS shopeefood_db.order_message_reads (
  user_id INT UNSIGNED NOT NULL,
  order_id INT UNSIGNED NOT NULL,
  last_message_id INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (user_id, order_id),

  CONSTRAINT fk_omr_user
    FOREIGN KEY (user_id)
    REFERENCES shopeefood_db.users(id),

  CONSTRAINT fk_omr_order
    FOREIGN KEY (order_id)
    REFERENCES shopeefood_db.orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
