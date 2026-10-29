USE shopeefood_db;

-- Application accounts.
CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(150) NOT NULL UNIQUE,
    full_name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(200) NOT NULL,
    role ENUM('manager', 'driver') NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE = InnoDB;

-- Server-side login sessions.
CREATE TABLE IF NOT EXISTS sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    csrf_token CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_sessions_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    INDEX idx_sessions_expiry (expires_at)
) ENGINE = InnoDB;

-- Link a driver profile to its login account.
ALTER TABLE drivers
    ADD COLUMN user_id INT UNSIGNED NULL,
    ADD CONSTRAINT uq_drivers_user UNIQUE (user_id),
    ADD CONSTRAINT fk_drivers_user
        FOREIGN KEY (user_id)
        REFERENCES users(id);

-- Verify the new tables and driver account field.
SHOW TABLES LIKE 'users';

SHOW TABLES LIKE 'sessions';

SHOW COLUMNS FROM drivers LIKE 'user_id';