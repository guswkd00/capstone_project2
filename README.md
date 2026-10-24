# ShopeeFood Delivery DSS

A food-delivery dispatch decision support system for managers and drivers. Managers can review ranked driver recommendations, approve assignments, override decisions with a reason, and track delivery performance. Drivers can update the progress of their own assigned deliveries.

This is an academic capstone prototype. It is not an official ShopeeFood service. Demonstration records are synthetic.

- Application: https://shopeefood-delivery-dss.onrender.com
- Deployment branch: `feature/fleet-dispatch-dss`
- Backend: Node.js, Express and MySQL2
- Database: local MySQL or TiDB Cloud over TLS
- Frontend: HTML, CSS and JavaScript
- Email: Brevo transactional HTTP API

## Features and access

| Area | Current functionality |
| --- | --- |
| Authentication | Manager/Driver login, server-side sessions, logout and role checks |
| Orders | Create orders, review pending/all orders and view order details |
| Dispatch | Rank eligible drivers, approve recommendations and override/reassign with a reason |
| Dispatch history | Review decisions and stored candidate snapshots |
| Fleet | Add/edit drivers and vehicles; view service zones |
| Driver portal | Start delivery, confirm restaurant arrival, confirm pickup, complete or fail delivery |
| Reports | Delivery outcomes, on-time performance, delivery duration, COD and driver performance |
| Account recovery | Email reset links, password replacement and session revocation |
| Email notifications | Successful sign-in and password-change notices when email delivery is configured |

Management APIs require a Manager account. Drivers can access their own deliveries. Zone editing, account administration and persistent alert resolution are not implemented as general CRUD APIs in this version.

## Project structure

```text
.github/workflows/ci.yml       GitHub Actions checks
README.md
backend/
  server.js                   Express entry point and route protection
  package.json
  package-lock.json
  .env.example                Local configuration template
  public/                     Login, Manager and Driver interfaces
  src/                        Authentication, database, dispatch, reports and email
  scripts/                    Account creation, schema export and TiDB migration
  sql/                        Database schemas and sample data
```

## Run locally

Use Node.js 24 and a MySQL-compatible database. Run these commands from the repository root:

```bash
cd backend
npm ci
```

Copy `backend/.env.example` to `backend/.env` and configure your own local database credentials:

```dotenv
DATABASE_TARGET=local
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=your_database_user
DB_PASSWORD=your_database_password
DB_NAME=shopeefood_db
HOST=127.0.0.1
PORT=3000
```

Do not commit `.env` files or real credentials.

### Database initialization

For a **new, empty database**, create `shopeefood_db` with `utf8mb4` / `utf8mb4_unicode_ci`, then import `backend/sql/006-tidb-schema.sql`. This file defines the ten core tables. It is not a complete data seed and does not include the password reset table.

Add the password reset table after the `users` table exists:

```sql
CREATE TABLE IF NOT EXISTS shopeefood_db.password_reset_tokens (
  token_hash CHAR(64) NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  email_at_issue VARCHAR(150) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token_hash),
  KEY idx_password_reset_user_time (user_id, created_at),
  KEY idx_password_reset_expiry (expires_at),
  CONSTRAINT fk_password_reset_user
    FOREIGN KEY (user_id) REFERENCES shopeefood_db.users (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

The other numbered SQL files are historical incremental changes. Do not run every SQL file indiscriminately against an existing database. In TiDB, verify that CHECK constraints are enabled and inspect `SHOW CREATE TABLE` after schema creation; older imports may have skipped them with warnings.

### Initial demonstration accounts

For a fresh demonstration environment, set `APP_SEED_PASSWORD` privately to a password of 12–200 characters without surrounding spaces, then run:

```bash
node scripts/create-accounts.js
```

The script creates `manager@demo.local` and driver accounts using `<lowercase-driver-code>@demo.local` for drivers already in the database. Existing accounts retain their passwords. A schema-only database has no driver records, so driver accounts require driver data first.

Do not rerun this provisioning script on the deployed database after replacing demonstration email addresses; it uses the original demo addresses and can create unwanted accounts or conflict with existing driver links. Use separate passwords for accounts that will be shared.

Start the server:

```bash
npm start
```

Open http://127.0.0.1:3000/login.html. The health endpoint is `/api/health`; a healthy database connection returns `{"status":"ok"}`.

## TiDB configuration

Set the following variables in your private environment instead of the local database settings:

```dotenv
DATABASE_TARGET=tidb
TIDB_HOST=your_tidb_host
TIDB_PORT=4000
TIDB_USER=your_tidb_user
TIDB_PASSWORD=your_tidb_password
TIDB_DATABASE=shopeefood_db
```

Use the port and credentials supplied by your TiDB instance. The application verifies TLS certificates and uses UTC database sessions.

```bash
node scripts/test-tidb.js
```

`scripts/migrate-to-tidb.js` is a separate data-copy utility. Review its configuration and destination before running it; it is not required for normal startup or CI.

## Email and password recovery

Configure these private environment variables:

| Variable | Purpose |
| --- | --- |
| `BREVO_API_KEY` | Brevo API key with transactional email sending access |
| `EMAIL_FROM` | Verified sender email address |
| `EMAIL_FROM_NAME` | Sender display name |
| `APP_PUBLIC_URL` | Public HTTPS origin, without a page path, query or fragment |

For this deployment, `APP_PUBLIC_URL` is `https://shopeefood-delivery-dss.onrender.com`.

Email delivery requires both a verified sender and an enabled Brevo transactional sending platform. The observed error **“Your sending platform is currently disabled”** requires account review/reactivation by Brevo; changing application code or regenerating the API key does not establish that the account is enabled.

Recovery flow:

1. Open `/forgot-password.html` and enter the email registered to the account.
2. The page returns a generic response to avoid revealing whether an account exists. This response is not delivery confirmation.
3. Open the most recently issued email link within 30 minutes.
4. Choose a new password of 12–200 characters without surrounding spaces.
5. Sign in again. A successful password reset invalidates the account's existing sessions.

Issuance is limited to three reset tokens per account per hour, with additional IP rate limiting. Tokens are single-use; newer tokens invalidate older outstanding tokens. `/api/auth/email-status` reports whether the required email settings are present, not whether the provider can deliver email.

## Dispatch model

The model in `backend/src/dss.js` filters unsuitable candidates and ranks the remaining drivers by estimated travel distance, workload and lateness.

Eligibility checks cover driver availability, vehicle readiness, matching active zone, valid position, capacity, maintenance date and a maximum of three active orders.

Estimates use Haversine distance, a road factor of 1.3, a speed of 25 km/h, five pickup minutes and five additional minutes per active order.

```text
Score = estimated distance to restaurant
        + 4 × active orders
        + 2 × predicted late minutes
```

Lower scores rank first. These are rule-based estimates, not live traffic routing or a trained AI model. Assignment transactions lock relevant rows to guard against conflicting assignments.

## Delivery workflow

```text
pending / confirmed → assigned → delivering → completed
                                           ↘ failed
```

Drivers start the delivery, confirm restaurant arrival, enter the order code to confirm pickup, and submit completion or failure. Completion validates the required COD amount. Progress events are recorded in `order_events`.

## Continuous integration

`.github/workflows/ci.yml` runs on pushes and pull requests, and supports manual execution from GitHub Actions. It uses Node.js 24 and performs:

1. Dependency installation using `npm ci`.
2. Syntax checks for JavaScript files and classic inline JavaScript in HTML.
3. The five dispatch-model tests in `backend/src/dss.test.js`.

Run the model tests locally from `backend/`:

```bash
node --test src/dss.test.js
```

The current `npm test` script is a placeholder; CI invokes the real test file directly. CI does not use production database credentials, send email, run database migrations or exercise the entire browser/API workflow. A green run means these configured checks passed.

## Render deployment

| Setting | Value |
| --- | --- |
| Branch | `feature/fleet-dispatch-dss` |
| Runtime | Node.js 24 |
| Root directory | `backend` |
| Build command | `npm ci` |
| Start command | `node server.js` |
| Host | `HOST=0.0.0.0` |
| Proxy | `TRUST_PROXY=1` |
| HTTPS cookies | `COOKIE_SECURE=1` |
| Environment | `NODE_ENV=production` |

Configure TiDB and email variables in Render's Environment settings. Let Render supply `PORT`.

With Auto-Deploy set to **On Commit**, commits to the configured branch trigger deployment independently of CI results. To require successful checks first, use **After CI Checks Pass** if available and ensure Render recognizes the workflow. CI itself does not deploy the application.

If a commit does not trigger deployment, compare the GitHub branch with the Render branch, inspect Build Filters and check Render Events. If deployment succeeds but the browser shows old content, force a reload. Free Render instances can sleep when inactive, delaying the first request.

## Security and limitations

- Passwords use salted scrypt hashes; session and password-reset tokens are stored as SHA-256 hashes.
- Sessions expire after eight hours. Cookies use HttpOnly and SameSite=Strict, with Secure enabled for HTTPS deployments.
- Protected write requests require CSRF validation. Management endpoints enforce server-side roles.
- Password recovery responses do not confirm whether an email account exists.
- Login and IP-based recovery limits are held in process memory and reset when the application restarts.
- Never upload database credentials, API keys, session cookies or password-reset links to GitHub.
- Database timestamps use UTC. Review local display settings when comparing UI, provider and server logs.
- Root-level `Intro.html` is separate from the application served from `backend/public`.
