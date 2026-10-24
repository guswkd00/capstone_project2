USE shopeefood_db;

-- 1. Service zones
CREATE TABLE IF NOT EXISTS zones (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,

  PRIMARY KEY (id),
  UNIQUE KEY name (name),

  CONSTRAINT zones_chk_1
    CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT zones_chk_2
    CHECK (longitude BETWEEN -180 AND 180)
) ENGINE=InnoDB AUTO_INCREMENT=3
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 2. Vehicles
CREATE TABLE IF NOT EXISTS vehicles (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  plate_number VARCHAR(30) NOT NULL,
  vehicle_type ENUM('motorbike','van')
    NOT NULL DEFAULT 'motorbike',
  capacity_kg DECIMAL(8,2) NOT NULL,
  cost_per_km DECIMAL(10,2) NOT NULL DEFAULT 1500.00,
  status ENUM('available','maintenance','inactive')
    NOT NULL DEFAULT 'available',
  maintenance_due DATE NOT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY plate_number (plate_number),

  CONSTRAINT vehicles_chk_1 CHECK (capacity_kg > 0),
  CONSTRAINT vehicles_chk_2 CHECK (cost_per_km >= 0)
) ENGINE=InnoDB AUTO_INCREMENT=6
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 3. Application accounts
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(150) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  password_hash VARCHAR(200) NOT NULL,
  role ENUM('manager','driver') NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY email (email)
) ENGINE=InnoDB AUTO_INCREMENT=6
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 4. Drivers
CREATE TABLE IF NOT EXISTS drivers (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  driver_code VARCHAR(30) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  zone_id INT UNSIGNED NOT NULL,
  vehicle_id INT UNSIGNED NOT NULL,
  status ENUM('available','offline')
    NOT NULL DEFAULT 'available',
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  user_id INT UNSIGNED DEFAULT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY driver_code (driver_code),
  UNIQUE KEY vehicle_id (vehicle_id),
  UNIQUE KEY uq_drivers_user (user_id),
  KEY zone_id (zone_id),

  CONSTRAINT drivers_ibfk_1
    FOREIGN KEY (zone_id) REFERENCES zones (id),
  CONSTRAINT drivers_ibfk_2
    FOREIGN KEY (vehicle_id) REFERENCES vehicles (id),
  CONSTRAINT fk_drivers_user
    FOREIGN KEY (user_id) REFERENCES users (id),

  CONSTRAINT drivers_chk_1
    CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT drivers_chk_2
    CHECK (longitude BETWEEN -180 AND 180)
) ENGINE=InnoDB AUTO_INCREMENT=5
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 5. Restaurants
CREATE TABLE IF NOT EXISTS restaurants (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  address VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NOT NULL,
  zone_id INT UNSIGNED NOT NULL,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  accepting_orders TINYINT(1) NOT NULL DEFAULT 1,
  estimated_prep_minutes SMALLINT UNSIGNED NOT NULL DEFAULT 15,

  PRIMARY KEY (id),
  UNIQUE KEY name (name),
  KEY zone_id (zone_id),

  CONSTRAINT restaurants_ibfk_1
    FOREIGN KEY (zone_id) REFERENCES zones (id),

  CONSTRAINT restaurants_chk_1
    CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT restaurants_chk_2
    CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT restaurants_chk_3
    CHECK (estimated_prep_minutes <= 180)
) ENGINE=InnoDB AUTO_INCREMENT=3
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 6. Food orders
CREATE TABLE IF NOT EXISTS orders (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_code VARCHAR(30) NOT NULL,
  customer_name VARCHAR(100) NOT NULL,
  customer_phone VARCHAR(20) NOT NULL,
  delivery_address VARCHAR(255) NOT NULL,
  total_amount DECIMAL(12,2) NOT NULL,

  status ENUM(
    'pending',
    'confirmed',
    'assigned',
    'delivering',
    'completed',
    'failed',
    'cancelled'
  ) NOT NULL DEFAULT 'pending',

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  zone_id INT UNSIGNED DEFAULT NULL,
  driver_id INT UNSIGNED DEFAULT NULL,
  weight_kg DECIMAL(8,2) NOT NULL DEFAULT 1.00,
  latitude DECIMAL(10,7) DEFAULT NULL,
  longitude DECIMAL(10,7) DEFAULT NULL,

  due_at DATETIME DEFAULT NULL,
  assigned_at DATETIME DEFAULT NULL,
  started_at DATETIME DEFAULT NULL,
  delivered_at DATETIME DEFAULT NULL,

  estimated_distance_km DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  estimated_delivery_minutes INT UNSIGNED DEFAULT NULL,
  estimated_cost DECIMAL(12,2) NOT NULL DEFAULT 0.00,

  cod_amount DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  cod_collected DECIMAL(12,2) DEFAULT NULL,
  delivery_note VARCHAR(500) DEFAULT NULL,
  failure_reason VARCHAR(500) DEFAULT NULL,

  restaurant_id INT UNSIGNED DEFAULT NULL,
  food_subtotal DECIMAL(12,2) DEFAULT NULL,
  delivery_fee DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  payment_method ENUM('prepaid','cash')
    NOT NULL DEFAULT 'prepaid',

  restaurant_arrived_at DATETIME DEFAULT NULL,
  picked_up_at DATETIME DEFAULT NULL,

  PRIMARY KEY (id),
  UNIQUE KEY order_code (order_code),
  KEY fk_orders_zone (zone_id),
  KEY fk_orders_driver (driver_id),
  KEY fk_orders_restaurant (restaurant_id),

  CONSTRAINT fk_orders_driver
    FOREIGN KEY (driver_id) REFERENCES drivers (id),
  CONSTRAINT fk_orders_restaurant
    FOREIGN KEY (restaurant_id) REFERENCES restaurants (id),
  CONSTRAINT fk_orders_zone
    FOREIGN KEY (zone_id) REFERENCES zones (id),

  CONSTRAINT chk_orders_cod
    CHECK (cod_amount >= 0 AND cod_amount <= total_amount),
  CONSTRAINT chk_orders_delivery_fee CHECK (delivery_fee >= 0),
  CONSTRAINT chk_orders_food_subtotal CHECK (food_subtotal >= 0),
  CONSTRAINT chk_orders_latitude
    CHECK (latitude BETWEEN -90 AND 90),
  CONSTRAINT chk_orders_longitude
    CHECK (longitude BETWEEN -180 AND 180),
  CONSTRAINT chk_orders_total CHECK (total_amount >= 0),
  CONSTRAINT chk_orders_weight CHECK (weight_kg > 0)
) ENGINE=InnoDB AUTO_INCREMENT=7
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 7. Food items
CREATE TABLE IF NOT EXISTS order_items (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id INT UNSIGNED NOT NULL,
  item_name VARCHAR(150) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price DECIMAL(12,2) NOT NULL,

  PRIMARY KEY (id),
  KEY order_id (order_id),

  CONSTRAINT order_items_ibfk_1
    FOREIGN KEY (order_id) REFERENCES orders (id),

  CONSTRAINT order_items_chk_1 CHECK (quantity > 0),
  CONSTRAINT order_items_chk_2 CHECK (unit_price >= 0)
) ENGINE=InnoDB AUTO_INCREMENT=9
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 8. Delivery event timeline
CREATE TABLE IF NOT EXISTS order_events (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id INT UNSIGNED NOT NULL,
  actor_user_id INT UNSIGNED NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  note VARCHAR(500) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY fk_order_events_actor (actor_user_id),
  KEY idx_order_events_order (order_id, id),

  CONSTRAINT fk_order_events_actor
    FOREIGN KEY (actor_user_id) REFERENCES users (id),
  CONSTRAINT fk_order_events_order
    FOREIGN KEY (order_id) REFERENCES orders (id)
) ENGINE=InnoDB AUTO_INCREMENT=9
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 9. Dispatch decision history
CREATE TABLE IF NOT EXISTS dispatch_history (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id INT UNSIGNED NOT NULL,
  driver_id INT UNSIGNED NOT NULL,
  vehicle_id INT UNSIGNED NOT NULL,
  decision_type ENUM('recommended','override') NOT NULL,
  reason VARCHAR(500) NOT NULL,
  score DECIMAL(10,2) NOT NULL,
  estimated_distance_km DECIMAL(10,2) NOT NULL,
  estimated_delivery_minutes INT UNSIGNED NOT NULL,
  estimated_cost DECIMAL(12,2) NOT NULL,
  candidates_snapshot JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY order_id (order_id),
  KEY driver_id (driver_id),
  KEY vehicle_id (vehicle_id),

  CONSTRAINT dispatch_history_ibfk_1
    FOREIGN KEY (order_id) REFERENCES orders (id),
  CONSTRAINT dispatch_history_ibfk_2
    FOREIGN KEY (driver_id) REFERENCES drivers (id),
  CONSTRAINT dispatch_history_ibfk_3
    FOREIGN KEY (vehicle_id) REFERENCES vehicles (id)
) ENGINE=InnoDB AUTO_INCREMENT=3
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- 10. Login sessions
CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  csrf_token CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (token_hash),
  KEY fk_sessions_user (user_id),
  KEY idx_sessions_expiry (expires_at),

  CONSTRAINT fk_sessions_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


SHOW TABLES;