USE shopeefood_db;

-- Pickup hubs and service zones.
CREATE TABLE IF NOT EXISTS zones (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,

    CHECK (latitude BETWEEN -90 AND 90),
    CHECK (longitude BETWEEN -180 AND 180)
) ENGINE = InnoDB;

-- Fleet vehicles.
CREATE TABLE IF NOT EXISTS vehicles (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    plate_number VARCHAR(30) NOT NULL UNIQUE,
    vehicle_type ENUM('motorbike', 'van')
        NOT NULL DEFAULT 'motorbike',
    capacity_kg DECIMAL(8,2) NOT NULL,
    cost_per_km DECIMAL(10,2) NOT NULL DEFAULT 1500,
    status ENUM('available', 'maintenance', 'inactive')
        NOT NULL DEFAULT 'available',
    maintenance_due DATE NOT NULL,

    CHECK (capacity_kg > 0),
    CHECK (cost_per_km >= 0)
) ENGINE = InnoDB;

-- Drivers and their assigned vehicles.
CREATE TABLE IF NOT EXISTS drivers (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    driver_code VARCHAR(30) NOT NULL UNIQUE,
    full_name VARCHAR(100) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    zone_id INT UNSIGNED NOT NULL,
    vehicle_id INT UNSIGNED NOT NULL UNIQUE,
    status ENUM('available', 'offline')
        NOT NULL DEFAULT 'available',
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,

    FOREIGN KEY (zone_id) REFERENCES zones(id),
    FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),

    CHECK (latitude BETWEEN -90 AND 90),
    CHECK (longitude BETWEEN -180 AND 180)
) ENGINE = InnoDB;

-- Synthetic demonstration hubs.
INSERT INTO zones (name, latitude, longitude)
SELECT 'Central Hub', 10.7769, 106.7009
WHERE NOT EXISTS (
    SELECT 1 FROM zones WHERE name = 'Central Hub'
);

INSERT INTO zones (name, latitude, longitude)
SELECT 'North Hub', 10.8015, 106.7100
WHERE NOT EXISTS (
    SELECT 1 FROM zones WHERE name = 'North Hub'
);

-- Synthetic demonstration vehicles.
INSERT INTO vehicles (
    plate_number, vehicle_type, capacity_kg,
    cost_per_km, status, maintenance_due
)
SELECT
    'DEMO-001', 'motorbike', 20,
    1500, 'available', DATE_ADD(CURDATE(), INTERVAL 60 DAY)
WHERE NOT EXISTS (
    SELECT 1 FROM vehicles WHERE plate_number = 'DEMO-001'
);

INSERT INTO vehicles (
    plate_number, vehicle_type, capacity_kg,
    cost_per_km, status, maintenance_due
)
SELECT
    'DEMO-002', 'motorbike', 15,
    1500, 'available', DATE_ADD(CURDATE(), INTERVAL 60 DAY)
WHERE NOT EXISTS (
    SELECT 1 FROM vehicles WHERE plate_number = 'DEMO-002'
);

INSERT INTO vehicles (
    plate_number, vehicle_type, capacity_kg,
    cost_per_km, status, maintenance_due
)
SELECT
    'DEMO-003', 'van', 100,
    4000, 'maintenance', DATE_ADD(CURDATE(), INTERVAL 30 DAY)
WHERE NOT EXISTS (
    SELECT 1 FROM vehicles WHERE plate_number = 'DEMO-003'
);

-- Synthetic demonstration drivers.
INSERT INTO drivers (
    driver_code, full_name, phone,
    zone_id, vehicle_id, latitude, longitude
)
SELECT
    'DRV001', 'Jamie Nguyen', '0900000011',
    z.id, v.id, 10.7780, 106.7020
FROM zones z
JOIN vehicles v ON v.plate_number = 'DEMO-001'
WHERE z.name = 'Central Hub'
AND NOT EXISTS (
    SELECT 1 FROM drivers WHERE driver_code = 'DRV001'
);

INSERT INTO drivers (
    driver_code, full_name, phone,
    zone_id, vehicle_id, latitude, longitude
)
SELECT
    'DRV002', 'Taylor Tran', '0900000012',
    z.id, v.id, 10.7850, 106.7090
FROM zones z
JOIN vehicles v ON v.plate_number = 'DEMO-002'
WHERE z.name = 'Central Hub'
AND NOT EXISTS (
    SELECT 1 FROM drivers WHERE driver_code = 'DRV002'
);

INSERT INTO drivers (
    driver_code, full_name, phone,
    zone_id, vehicle_id, latitude, longitude
)
SELECT
    'DRV003', 'Casey Le', '0900000013',
    z.id, v.id, 10.8030, 106.7120
FROM zones z
JOIN vehicles v ON v.plate_number = 'DEMO-003'
WHERE z.name = 'North Hub'
AND NOT EXISTS (
    SELECT 1 FROM drivers WHERE driver_code = 'DRV003'
);

-- Verify the fleet relationships.
SELECT
    d.driver_code,
    d.full_name,
    z.name AS service_zone,
    v.plate_number,
    v.capacity_kg,
    v.status AS vehicle_status,
    d.status AS driver_status
FROM drivers d
JOIN zones z ON z.id = d.zone_id
JOIN vehicles v ON v.id = d.vehicle_id
ORDER BY d.driver_code;