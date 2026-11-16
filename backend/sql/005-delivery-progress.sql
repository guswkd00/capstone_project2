USE shopeefood_db;

-- Record restaurant arrival and food pickup times.
ALTER TABLE orders
    ADD COLUMN restaurant_arrived_at DATETIME NULL,
    ADD COLUMN picked_up_at DATETIME NULL;

-- Preserve delivery actions and the account performing them.
CREATE TABLE IF NOT EXISTS order_events (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id INT UNSIGNED NOT NULL,
    actor_user_id INT UNSIGNED NOT NULL,
    event_type VARCHAR(40) NOT NULL,
    note VARCHAR(500) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_order_events_order
        FOREIGN KEY (order_id)
        REFERENCES orders(id),

    CONSTRAINT fk_order_events_actor
        FOREIGN KEY (actor_user_id)
        REFERENCES users(id),

    INDEX idx_order_events_order (order_id, id)
) ENGINE = InnoDB;

-- Verify the added fields and event table.
SHOW COLUMNS FROM orders LIKE 'restaurant_arrived_at';

SHOW COLUMNS FROM orders LIKE 'picked_up_at';

SHOW TABLES LIKE 'order_events';