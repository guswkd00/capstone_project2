USE shopeefood_db;

-- Extend existing orders for dispatch and delivery tracking.
ALTER TABLE orders
    ADD COLUMN zone_id INT UNSIGNED NULL,
    ADD COLUMN driver_id INT UNSIGNED NULL,
    ADD COLUMN weight_kg DECIMAL(8,2) NOT NULL DEFAULT 1,
    ADD COLUMN latitude DECIMAL(10,7) NULL,
    ADD COLUMN longitude DECIMAL(10,7) NULL,
    ADD COLUMN due_at DATETIME NULL,
    ADD COLUMN assigned_at DATETIME NULL,
    ADD COLUMN started_at DATETIME NULL,
    ADD COLUMN delivered_at DATETIME NULL,
    ADD COLUMN estimated_distance_km DECIMAL(10,2)
        NOT NULL DEFAULT 0,
    ADD COLUMN estimated_delivery_minutes INT UNSIGNED NULL,
    ADD COLUMN estimated_cost DECIMAL(12,2)
        NOT NULL DEFAULT 0,
    ADD COLUMN cod_amount DECIMAL(12,2)
        NOT NULL DEFAULT 0,
    ADD COLUMN cod_collected DECIMAL(12,2) NULL,
    ADD COLUMN delivery_note VARCHAR(500) NULL,
    ADD COLUMN failure_reason VARCHAR(500) NULL,

    ADD CONSTRAINT fk_orders_zone
        FOREIGN KEY (zone_id) REFERENCES zones(id),

    ADD CONSTRAINT fk_orders_driver
        FOREIGN KEY (driver_id) REFERENCES drivers(id),

    ADD CONSTRAINT chk_orders_weight
        CHECK (weight_kg > 0),

    ADD CONSTRAINT chk_orders_cod
        CHECK (cod_amount >= 0 AND cod_amount <= total_amount),

    ADD CONSTRAINT chk_orders_latitude
        CHECK (latitude BETWEEN -90 AND 90),

    ADD CONSTRAINT chk_orders_longitude
        CHECK (longitude BETWEEN -180 AND 180);

-- Add the assignment and failure states.
ALTER TABLE orders
    MODIFY COLUMN status ENUM(
        'pending',
        'confirmed',
        'assigned',
        'delivering',
        'completed',
        'failed',
        'cancelled'
    ) NOT NULL DEFAULT 'pending';

-- Preserve dispatch decisions for review.
CREATE TABLE IF NOT EXISTS dispatch_history (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id INT UNSIGNED NOT NULL,
    driver_id INT UNSIGNED NOT NULL,
    vehicle_id INT UNSIGNED NOT NULL,
    decision_type ENUM('recommended', 'override')
        NOT NULL,
    reason VARCHAR(500) NOT NULL,
    score DECIMAL(10,2) NOT NULL,
    estimated_distance_km DECIMAL(10,2) NOT NULL,
    estimated_delivery_minutes INT UNSIGNED NOT NULL,
    estimated_cost DECIMAL(12,2) NOT NULL,
    candidates_snapshot JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (driver_id) REFERENCES drivers(id),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
) ENGINE = InnoDB;

-- Supply missing routing data for the existing demo orders.
-- Customer names, amounts and order statuses remain unchanged.
UPDATE orders
SET
    zone_id = COALESCE(
        zone_id,
        (SELECT id FROM zones WHERE name = 'Central Hub')
    ),
    latitude = COALESCE(latitude, 10.7820),
    longitude = COALESCE(longitude, 106.7080),
    due_at = COALESCE(
        due_at,
        DATE_ADD(UTC_TIMESTAMP(), INTERVAL 90 MINUTE)
    )
WHERE
    zone_id IS NULL
    OR latitude IS NULL
    OR longitude IS NULL
    OR due_at IS NULL;

-- Check dispatch information.
SELECT
    o.order_code,
    z.name AS service_zone,
    o.weight_kg,
    o.latitude,
    o.longitude,
    o.due_at AS deadline_utc,
    o.status,
    d.full_name AS assigned_driver
FROM orders o
LEFT JOIN zones z ON z.id = o.zone_id
LEFT JOIN drivers d ON d.id = o.driver_id
ORDER BY o.id;