# ShopeeFood Delivery DSS

A Fleet & Delivery Dispatch Decision Support System for managers and drivers.

The system supports order management, driver recommendations, dispatch approval, delivery tracking, delivery evidence, COD handover, vehicle expenses and operational reporting.

This is an academic capstone prototype. It is not an official ShopeeFood service. Demonstration orders, customers, drivers and vehicles are synthetic.

## Live application

- Login: https://shopee-food.onrender.com/login.html
- Application: https://shopee-food.onrender.com
- Deployment branch: `feature/fleet-dispatch-dss`
- Health endpoint: `/api/health`

Manager and Driver credentials are provided privately. Passwords are not published in this repository.

## Technology stack

| Component | Technology |
| --- | --- |
| Backend | Node.js 24, Express |
| Database access | MySQL2 |
| Database | TiDB Cloud or local MySQL |
| Frontend | HTML, CSS and JavaScript |
| Map interface | Leaflet |
| Map tiles | OpenStreetMap |
| Email | Brevo transactional HTTP API |
| Hosting | Render |
| CI | GitHub Actions |

## Problem and purpose

Manual dispatch can result in unsuitable assignments, uneven workloads, late deliveries and limited visibility into delivery outcomes.

The system helps a Manager compare eligible drivers using operational rules and estimated distance, workload and lateness. The Manager retains control over the final assignment.

It also records delivery progress, evidence, COD handover and vehicle expenses for operational review.

## Features

| Area | Functionality |
| --- | --- |
| Authentication | Manager/Driver login, server-side sessions, logout and role checks |
| Account recovery | Email reset links, password replacement and session revocation |
| Email notifications | Successful sign-in and password-change notices when email delivery is configured and available |
| Orders | Create orders, review pending/all orders and view order details |
| Dispatch | Rank eligible drivers, approve recommendations and override/reassign with a reason |
| Dispatch history | Review decisions and stored candidate snapshots |
| Dispatch map | Vehicle markers, driver information, assignment controls and delivery tracking |
| Fleet | Add/edit drivers and vehicles; view service zones |
| Driver portal | View own deliveries, update delivery progress and report failures |
| GPS | Driver-controlled location sharing while the page remains open |
| Suggested stops | Pickup-aware ordering of stops for the driver's active deliveries |
| Delivery evidence | Required driver photo upload and protected Manager photo viewing |
| Payments | Prepaid and cash-on-delivery orders |
| COD handover | Manager confirmation of money received, with amount, confirmer and timestamp |
| Vehicle expenses | Fuel, maintenance and other expense recording with per-vehicle history |
| Maintenance alerts | Vehicles in maintenance, overdue, due today or due within seven days |
| Reports | Delivery outcomes, on-time rate, duration, failure rate, current fleet utilization and costs |
| Export | Dashboard KPI CSV export and browser print/Save PDF |

Zone editing, general account administration and persistent alert resolution are not implemented as general CRUD APIs in this version.

## Roles and access

### Manager

- Manage orders, drivers and vehicles.
- Review recommendations and approve assignments.
- Record override or reassignment reasons.
- View delivery progress and uploaded evidence.
- Confirm COD handover.
- Record vehicle expenses and review maintenance alerts.
- View and export reports.

### Driver

- Access deliveries assigned to the linked driver account.
- Start delivery and confirm arrival at the restaurant.
- Confirm pickup using the matching order code.
- Upload delivery evidence and record COD collected.
- Complete a delivery or report failure.
- Share device location.
- View suggested pickup and delivery stops.

Management APIs enforce Manager access on the server. Driver delivery queries enforce ownership.

## Project structure

```text
.github/workflows/ci.yml       GitHub Actions checks
README.md
backend/
  server.js                   Express entry point and route protection
  package.json
  package-lock.json
  .env.example                Configuration template
  public/                     Manager and Driver interfaces
  src/
    auth.js                   Authentication and access checks
    db.js                     Database connection
    dss.js                    Recommendation model
    dispatch.js               Dispatch APIs
    driver.js                 Driver APIs and delivery workflow
    delivery-proof.js         Photo upload API
    route-planner.js          Suggested stop ordering
    fleet.js                  Fleet, expenses and maintenance APIs
    orders.js                 Orders, photo viewing and COD handover
    reports.js                Reporting APIs
  scripts/                    Account provisioning and database utilities
  sql/                        Database schemas
```

## Local installation

### 1. Install dependencies

Use Node.js 24.

From the repository root:

```bash
cd backend
npm ci
```

### 2. Configure the environment

Copy `backend/.env.example` to `backend/.env`.

Enter your own local database credentials:

```dotenv
DATABASE_TARGET=local
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=your_database_user
DB_PASSWORD=your_database_password
DB_NAME=shopeefood_db

HOST=127.0.0.1
PORT=3000
TRUST_PROXY=0
COOKIE_SECURE=0

APP_PUBLIC_URL=http://127.0.0.1:3000
```

Do not commit `.env` or real credentials.

### 3. Initialize a new database

These instructions are for a new, empty database. Do not recreate or reseed the existing deployed database.

Create the database:

```sql
CREATE DATABASE IF NOT EXISTS shopeefood_db
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;
```

Import the following files in order:

1. `backend/sql/006-tidb-schema.sql`
2. `backend/sql/007-delivery-operations.sql`

The core schema includes GPS metadata in the `drivers` table. The operations schema creates:

- `order_delivery_proofs`
- `order_cod_settlements`
- `vehicle_expenses`

Create the password-reset table after the `users` table exists:

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
    FOREIGN KEY (user_id)
    REFERENCES shopeefood_db.users(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;
```

The schema files do not recreate the full demonstration dataset.

The existing demonstration environment was populated separately with 200 synthetic orders and 60 additional synthetic drivers and vehicles. The core and operations schemas alone do not generate those records.

Other SQL files contain historical setup or incremental changes. Review them before use rather than running every SQL file against an existing database.

For an existing database, compare its structure with the required schema and apply only missing changes. `CREATE TABLE IF NOT EXISTS` does not add missing columns to an existing table.

### 4. Provision initial accounts

For a fresh demonstration environment, set `APP_SEED_PASSWORD` privately to a password of 12–200 characters without surrounding spaces.

From `backend/`, run:

```bash
node scripts/create-accounts.js
```

The script provisions `manager@demo.local` and driver accounts based on driver records already in the database. A schema-only database has no drivers.

Do not rerun this script on the existing deployment after replacing demo email addresses. It uses the original demo addresses and can create unwanted accounts or conflict with existing driver links.

The Manager interface also supports creating login accounts for existing synthetic demo drivers using Gmail aliases. This requires existing demo driver records.

### 5. Start the application

```bash
npm start
```

Open:

```text
http://127.0.0.1:3000/login.html
```

A healthy database connection returns:

```json
{"status":"ok"}
```

from `/api/health`.

## TiDB Cloud configuration

To connect to TiDB, configure:

```dotenv
DATABASE_TARGET=tidb
TIDB_HOST=your_tidb_host
TIDB_PORT=4000
TIDB_USER=your_tidb_user
TIDB_PASSWORD=your_tidb_password
TIDB_DATABASE=shopeefood_db
```

Use the credentials and port supplied by your TiDB instance.

The application verifies TLS certificates and uses UTC database sessions.

Test connectivity from `backend/`:

```bash
node scripts/test-tidb.js
```

Changing the hosting account does not require changing application users or passwords when the application connects to the same TiDB database.

All deployments connected to that database share the same records.

## Email configuration

Configure these values privately:

```dotenv
BREVO_API_KEY=your_private_api_key
EMAIL_FROM=your_verified_sender
EMAIL_FROM_NAME=ShopeeFood Delivery DSS
APP_PUBLIC_URL=https://shopee-food.onrender.com
```

`APP_PUBLIC_URL` must be the application origin without `/login.html`, a query string or a fragment.

Email requires:

- A valid API key with transactional sending permission.
- A verified sender.
- An enabled Brevo transactional sending platform.

Application configuration alone does not guarantee delivery.

The `/api/auth/email-status` endpoint reports configuration availability, not successful delivery.

### Password recovery

1. Open `/forgot-password.html`.
2. Enter the registered account email.
3. Open the most recent reset link from the email.
4. Set a password of 12–200 characters without surrounding spaces.
5. Sign in again.

Reset links expire after 30 minutes and are single-use. New links invalidate older outstanding links. Successful password reset revokes existing sessions.

The recovery page returns a generic response to avoid exposing whether an account exists. That response is not proof that an email was delivered.

## Driver recommendation model

The rule-based model checks:

- Driver availability.
- Vehicle availability.
- Matching active service zone.
- Valid coordinates.
- Vehicle payload capacity.
- Maintenance date.
- A maximum of three active orders.

Eligible drivers are ranked using:

```text
Score = estimated pickup distance in km
        + 4 × active orders
        + 2 × predicted late minutes
```

Lower scores rank first.

Distance and time estimates use:

- Haversine distance.
- A road factor of 1.3.
- Assumed speed of 25 km/h.
- Five pickup minutes.
- Five additional minutes per active order.

The Manager approves the final assignment. Selecting an alternative driver requires the applicable override reason.

The model is not a trained AI model and does not use live traffic.

## Suggested stop order

The driver route planner:

1. Reads only the signed-in driver's active deliveries.
2. Makes a delivery stop available only after its pickup.
3. Chooses the nearest currently available stop.
4. Continues until all planned deliveries are included.

Already collected orders do not receive another pickup stop.

Suggestions start from stored driver coordinates. Missing required coordinates produce an error rather than an incomplete route.

The planner is a nearest-stop heuristic, not a guarantee of the globally shortest or fastest route. Travel-time estimates exclude service time and live traffic.

Drivers should refresh suggested stops after changing delivery progress.

## Delivery workflow

```text
pending / confirmed
        ↓
     assigned
        ↓
travelling to restaurant
        ↓
   at restaurant
        ↓
food pickup confirmed
        ↓
delivering to customer
        ↓
     completed

Active deliveries can also be reported as failed.
```

The intermediate travel/pickup phases are derived from delivery status and recorded timestamps.

Drivers confirm pickup by entering the matching order code.

Completion requires:

- Confirmed food pickup.
- A delivery confirmation note.
- Collected COD matching the required amount.
- An uploaded delivery photo belonging to the assigned driver.

Progress events are recorded in `order_events`.

## Delivery photos

- Drivers choose an image from their device.
- The interface accepts JPEG, PNG and WebP.
- Source files may be up to 15 MB.
- Images are resized and converted to JPEG before upload.
- The uploaded image must be 5 MB or smaller.
- The server checks the image signature and delivery ownership.
- Upload is allowed after food pickup while the order is delivering.
- Photos are stored in TiDB.
- Managers view photos through an authenticated API.

Older completed orders may not have photos.

A photo is evidence submitted by the driver. It is not independent customer confirmation or automatic verification of successful delivery.

## COD handover

COD collection and money handover are separate records.

1. The driver records cash collected when completing a cash order.
2. The Manager enters the amount received from the driver.
3. The system verifies that it matches both required and collected COD.
4. The system records the Manager and confirmation time.

Only completed cash orders with a positive COD amount can be settled. Duplicate settlement is rejected.

Prepaid orders do not require COD handover.

This is an internal record of cash handover, not a payment gateway or bank transfer.

## Vehicle expenses and maintenance

Managers can record:

- Fuel expenses.
- Maintenance expenses.
- Other vehicle expenses.

Each record includes the vehicle, amount, expense date, description and recording Manager.

Expense history shows up to 200 recent records per selected vehicle.

Maintenance alerts identify:

- Vehicles currently in maintenance.
- Overdue maintenance.
- Maintenance due today.
- Maintenance due within seven days.

Maintenance alerts calculate dates using Vietnam time.

Recording a maintenance expense does not automatically change vehicle status or reschedule maintenance. Update those fields separately.

## Reporting definitions

| Metric | Definition |
| --- | --- |
| On-time rate | On-time completed orders divided by completed orders with both deadline and completion timestamps |
| Average delivery duration | Average time from delivery start to completion for completed orders with valid timestamps |
| Failure rate | Failed orders divided by completed plus failed orders |
| Current fleet utilization | Vehicles with assigned/delivering orders divided by all vehicles |
| Estimated completed delivery cost | Sum of recorded cost estimates for completed orders with valid estimates |
| Estimated cost per completed delivery | Average recorded estimate among completed orders with valid estimates |
| Recorded vehicle expenses | Sum of expense records entered by Managers |
| Recorded COD collected | Collected COD recorded on completed orders |

Reports currently cover all-time order results and expenses across all dates. Fleet utilization is a current snapshot, not an all-day utilization measurement.

Actual vehicle expenses are not allocated to individual deliveries. Recorded expense totals may be incomplete if expenses have not been entered.

The recent-orders table shows up to 50 records. KPI CSV exports the displayed summary metrics, not the complete order database.

Use **Print / Save PDF** to print the report or save it through the browser.

## Map and GPS behavior

- Leaflet displays pickup, delivery and vehicle coordinates.
- Drivers explicitly enable location sharing.
- Location sharing requires browser permission and a secure context.
- The driver page must remain open for updates.
- Tracking distinguishes stored positions and GPS update freshness.
- Progress buttons do not automatically move driver coordinates.
- Dashed lines are schematic connections, not road navigation.

A stored demo location is not live GPS. Enabling GPS on a device far from the demonstration service area can make the driver appear far from the restaurant.

Map tiles require access to OpenStreetMap. DNS or network failures can leave a grey map even when markers and delivery data load.

## Continuous integration

GitHub Actions runs on pushes, pull requests and manual execution.

The workflow contains two jobs:

1. **JavaScript and unit tests**
   - Install locked dependencies with `npm ci`.
   - Check JavaScript syntax, including inline HTML scripts.
   - Run 5 DSS tests, 11 offline Manager AI tests and 5 Driver policy tests.

2. **Driver MySQL integration**
   - Start a separate MySQL 8.4 service.
   - Apply schemas in a disposable test database.
   - Run 11 Driver API/database integration tests covering authorization,
     concurrent acceptance, delivery progression, rewards, wallet requests,
     GPS validation and order messages.

Run the unit suites from `backend/`:

```bash
node --test \
  src/dss.test.js \
  src/manager-ai.test.js \
  src/driver-workspace.test.js
```

The current `npm test` script remains a placeholder.
CI runs the commands listed above directly.

Integration tests use synthetic fixtures in a disposable database.
They do not use production credentials or the deployed TiDB database.

Browser checks are separate from CI. A green CI run confirms the
configured checks passed; it does not verify every deployed feature.

## Driver workspace

The integrated Driver page provides:

- Authenticated profile and assigned deliveries.
- Validated delivery progression and required photo evidence.
- GPS sharing and pickup-aware route recommendations.
- Payment filters and configurable delivery distance limits.
- Persisted earnings, reward points and wallet requests.
- Order messages between Drivers and Manager support.

Managers can open **Fleet & Data → Driver Support** to review
withdrawal/top-up requests and reply to order messages.

Apply `backend/sql/013-driver-workspace.sql` before deploying these
features to an existing database with the required core schemas.
In the TiDB SQL Editor, execute each CREATE TABLE statement separately.

Bank transfers require external verification and Manager confirmation.
Customer messaging providers and payment gateways are not connected.

See [Driver workspace setup, APIs, policy and verification](docs/DRIVER_WORKSPACE.md)
for database prerequisites, configuration, test commands and integration
boundaries.


## Render deployment

| Setting | Value |
| --- | --- |
| Repository | `guswkd00/capstone_project2` |
| Branch | `feature/fleet-dispatch-dss` |
| Runtime | Node |
| Root directory | `backend` |
| Build command | `npm ci` |
| Start command | `node server.js` |
| Auto-Deploy | On Commit |

Configure the production environment:

```dotenv
DATABASE_TARGET=tidb
HOST=0.0.0.0
TRUST_PROXY=1
COOKIE_SECURE=1
NODE_ENV=production
APP_PUBLIC_URL=https://shopee-food.onrender.com
```

Add the private TiDB and Brevo settings in Render Environment. Let Render provide `PORT`.

With Root Directory set to `backend`, the Start Command is `node server.js`, not `node backend/server.js`.

Auto-Deploy On Commit is independent of CI results. CI itself does not deploy the application.

### Deployment troubleshooting

If an update is missing:

1. Verify the repository and branch in Render.
2. Check whether edits were committed to a fork or patch branch.
3. Merge the relevant Pull Request into `feature/fleet-dispatch-dss`.
4. Check Render Events for the deployed commit and Live status.
5. Deploy the latest commit if necessary.
6. Reload the browser with Ctrl + Shift + R.

A Live service can still be running an older commit. Compare commit IDs rather than relying only on the Live label.

Free instances may sleep when inactive, delaying the first request.

## Demonstration sequence

Use synthetic records and private demonstration credentials.

1. Sign in as Manager.
2. Review a pending order and compare recommended drivers.
3. Select a vehicle on the map and approve assignment.
4. Sign in as the assigned Driver in a separate browser session.
5. Review suggested stops and update delivery progress.
6. Confirm pickup with the matching order code.
7. Upload a photo, record the required COD and complete delivery.
8. As Manager, review the photo, delivery note and completion time.
9. Confirm a simulated COD handover for the synthetic order.
10. Record a clearly labelled demo vehicle expense.
11. Review Dashboard metrics and export KPI CSV.
12. Demonstrate that Drivers cannot access Manager reports or another driver's delivery.

Existing demonstration deadlines can become overdue over time. Do not present those records as evidence of real operational delivery performance.

The demonstration dataset is not evidence of production load capacity or hundreds of simultaneous HTTP requests.

## Security and limitations

- Passwords use salted scrypt hashes.
- Session and password-reset tokens are stored as SHA-256 hashes.
- Sessions expire after eight hours.
- Cookies use HttpOnly and SameSite=Strict.
- Production HTTPS cookies use Secure.
- Protected write requests require CSRF validation.
- Authorization is enforced on the server.
- Login and IP-based recovery limits are held in process memory.
- Database timestamps use UTC.
- Browser GPS is not guaranteed background tracking.
- Photo signatures are checked, but photo authenticity is not verified.
- The dispatch and stop-planning algorithms are rule-based estimates.
- Production performance and full concurrency have not been established by the synthetic dataset.
- Never commit credentials, API keys, session cookies or password-reset links.
- Root-level `Intro.html` is separate from the application served from `backend/public`.
