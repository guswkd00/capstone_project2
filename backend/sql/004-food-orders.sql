USE shopeefood_db;

-- Restaurant pickup locations.
CREATE TABLE IF NOT EXISTS restaurants (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL UNIQUE,
    address VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    zone_id INT UNSIGNED NOT NULL,
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    accepting_orders BOOLEAN NOT NULL DEFAULT TRUE,
    estimated_prep_minutes SMALLINT UNSIGNED
        NOT NULL DEFAULT 15,

    FOREIGN KEY (zone_id) REFERENCES zones(id),

    CHECK (latitude BETWEEN -90 AND 90),
    CHECK (longitude BETWEEN -180 AND 180),
    CHECK (estimated_prep_minutes <= 180)
) ENGINE = InnoDB;

-- Preserve the food names and prices recorded for each order.
CREATE TABLE IF NOT EXISTS order_items (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id INT UNSIGNED NOT NULL,
    item_name VARCHAR(150) NOT NULL,
    quantity INT UNSIGNED NOT NULL,
    unit_price DECIMAL(12,2) NOT NULL,

    FOREIGN KEY (order_id) REFERENCES orders(id),

    CHECK (quantity > 0),
    CHECK (unit_price >= 0)
) ENGINE = InnoDB;

-- Extend orders without deleting existing data.
ALTER TABLE orders
    ADD COLUMN restaurant_id INT UNSIGNED NULL,
    ADD COLUMN food_subtotal DECIMAL(12,2) NULL,
    ADD COLUMN delivery_fee DECIMAL(12,2)
        NOT NULL DEFAULT 0,
    ADD COLUMN payment_method ENUM('prepaid', 'cash')
        NOT NULL DEFAULT 'prepaid',

    ADD CONSTRAINT fk_orders_restaurant
        FOREIGN KEY (restaurant_id) REFERENCES restaurants(id),

    ADD CONSTRAINT chk_orders_food_subtotal
        CHECK (food_subtotal >= 0),

    ADD CONSTRAINT chk_orders_delivery_fee
        CHECK (delivery_fee >= 0);

-- Synthetic restaurants for the academic demonstration.
INSERT INTO restaurants (
    name,
    address,
    phone,
    zone_id,
    latitude,
    longitude,
    estimated_prep_minutes
)
SELECT
    'Demo Rice Kitchen',
    'Demo restaurant address, Central Zone',
    '0900000101',
    z.id,
    z.latitude,
    z.longitude,
    15
FROM zones z
WHERE z.name = 'Central Hub'
AND NOT EXISTS (
    SELECT 1
    FROM restaurants
    WHERE name = 'Demo Rice Kitchen'
);

INSERT INTO restaurants (
    name,
    address,
    phone,
    zone_id,
    latitude,
    longitude,
    estimated_prep_minutes
)
SELECT
    'Demo Noodle House',
    'Demo restaurant address, North Zone',
    '0900000102',
    z.id,
    z.latitude,
    z.longitude,
    20
FROM zones z
WHERE z.name = 'North Hub'
AND NOT EXISTS (
    SELECT 1
    FROM restaurants
    WHERE name = 'Demo Noodle House'
);

-- Attach legacy demo orders to a restaurant in their existing zone.
-- Demo restaurant coordinates match the previous pickup hub,
-- so existing assignments keep the same pickup location.
UPDATE orders o
JOIN restaurants r ON r.zone_id = o.zone_id
SET
    o.restaurant_id = COALESCE(o.restaurant_id, r.id),
    o.food_subtotal = COALESCE(
        o.food_subtotal,
        o.total_amount - o.delivery_fee
    ),
    o.payment_method = CASE
        WHEN o.cod_amount > 0 THEN 'cash'
        ELSE 'prepaid'
    END
WHERE r.name IN ('Demo Rice Kitchen', 'Demo Noodle House')
AND (
    o.restaurant_id IS NULL
    OR o.food_subtotal IS NULL
);

-- Represent each legacy demo order as one meal set.
INSERT INTO order_items (
    order_id,
    item_name,
    quantity,
    unit_price
)
SELECT
    o.id,
    'Demo Meal Set',
    1,
    o.food_subtotal
FROM orders o
WHERE o.restaurant_id IS NOT NULL
AND o.food_subtotal IS NOT NULL
AND NOT EXISTS (
    SELECT 1
    FROM order_items i
    WHERE i.order_id = o.id
);

-- Verify restaurant and food information.
SELECT
    o.order_code,
    r.name AS restaurant,
    i.item_name,
    i.quantity,
    i.unit_price,
    o.food_subtotal,
    o.delivery_fee,
    o.total_amount,
    o.payment_method,
    o.status
FROM orders o
LEFT JOIN restaurants r ON r.id = o.restaurant_id
LEFT JOIN order_items i ON i.order_id = o.id
ORDER BY o.id, i.id;