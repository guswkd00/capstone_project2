# Driver Workspace

## Overview

The Driver workspace uses the existing Express application, static
HTML/JavaScript frontend, MySQL/TiDB database, authenticated sessions
and CSRF protection.

Driver page: `/driver.html`

Manager support page: `/driver-support.html`

Manager navigation: Fleet & Data → Driver Support.

## Database setup

Required schemas:

1. `backend/sql/006-tidb-schema.sql`
2. `backend/sql/007-delivery-operations.sql`
3. `backend/sql/013-driver-workspace.sql`

For an existing installation, apply only missing migrations.
Do not recreate or reseed the deployed database.

When using the TiDB SQL Editor, execute each CREATE TABLE statement
separately and verify that all four Driver workspace tables exist:

- `driver_wallets`
- `driver_wallet_entries`
- `driver_wallet_requests`
- `driver_order_messages`

The migration preserves existing orders and financial records.
CREATE TABLE IF NOT EXISTS does not repair incompatible existing tables.

Apply the migration before deploying code that requires these tables.

## Authentication and authorization

The application reuses the existing session and role middleware.

- Driver identity comes from the authenticated account.
- Drivers can access only their own assigned deliveries and wallet.
- Driver message access is checked against the current assignment.
- Managers review wallet requests and reply through Manager-only APIs.
- Writes require the existing CSRF token.
- API requests without a valid session return HTTP 401.
- Unauthenticated Driver page requests redirect to `/login.html`.

## Delivery lifecycle

The existing domain states are preserved:

1. Assigned — awaiting start.
2. Delivering — travelling to the restaurant.
3. Delivering — arrived at the restaurant.
4. Delivering — food picked up and travelling to the customer.
5. Completed.

A delivery in progress may also be reported as failed.

Starting a delivery confirms an existing Manager assignment.
It does not self-assign an open order or immediately complete delivery.

Completion requires:

- Confirmed food pickup.
- A delivery photo.
- A delivery confirmation note.
- The exact required COD amount.

Prepaid orders use COD 0 and the COD input is read-only.

The backend validates transitions and uses database transactions.
Repeated completion requests cannot award the same delivery twice.

## Distance and route recommendations

The default maximum pickup-to-dropoff distance is 10 km.
Drivers may save a lower limit within the operator-configured maximum.

The backend calculates distance using the existing Haversine model
and road factor 1.3. Client-supplied distance is not trusted.

Starting a delivery also checks driver and vehicle availability,
maintenance, payload and the active matching service zone.

The existing route planner selects the nearest available stop while
preserving pickup-before-delivery precedence.

Recommendations use stored coordinates and estimated travel time.
They are not live traffic predictions or road navigation.

The delivery list refreshes every 30 seconds while visible and no
dialog is open. Route recommendations refresh after delivery and
GPS updates, with a manual refresh button also available.

## GPS

Location sharing starts only after the Driver selects Share GPS.

The browser uses watchPosition and requests location permission.
Uploads are throttled to approximately one per 15 seconds.

The API validates coordinate ranges, accuracy and supplied capture
timestamps. It rejects stale readings and applies a per-process
5-second interval between successful updates for each Driver.

Stop Sharing, page exit and sign-out stop browser tracking.
The last stored position remains available and is not described as
continuously live GPS after sharing stops.

## Earnings and rewards

This is a configurable academic prototype policy, not an official
ShopeeFood compensation policy.

Each newly completed delivery credits its persisted delivery_fee
to the Driver cash ledger and awards configured points.

Defaults:

| Setting | Default |
| --- | ---: |
| DRIVER_MAX_DELIVERY_KM | 10 |
| DRIVER_POINTS_PER_DELIVERY | 20 |
| DRIVER_BONUS_100 | 50000 VND |
| DRIVER_BONUS_180 | 120000 VND |
| DRIVER_BONUS_250 | 220000 VND |

Reward tiers use lifetime points at 100, 180 and 250.
A tier bonus is awarded when the Driver crosses that threshold.

Daily Bonus sums bonuses earned on the current Vietnam calendar date.
It does not award a separate bonus merely for opening the page.

Historical completed orders are not automatically backfilled.
Completed-order counts may therefore include orders that predate
the wallet and reward feature.

Completion, earnings and rewards commit in the same transaction.
Unique event keys prevent duplicate credits.

## Wallet requests

Request amounts must be whole VND from 10,000 to 10,000,000.

Withdrawals:

1. Driver creates a pending request.
2. Requested funds are reserved from available cash.
3. Manager rejection releases the reservation.
4. Manager approval deducts cash and releases the reservation.

Top-ups:

1. Driver creates a pending request.
2. Deposit balance remains unchanged.
3. Manager approval credits the deposit ledger after verification.
4. Manager rejection leaves the balance unchanged.

Requests use idempotency keys. Reusing a key with different details
is rejected. Manager reviews also handle repeated submissions.

Approval requires an external payment reference.
Rejection requires a reason.

The application records the review; it does not initiate a bank
transfer or independently verify a bank receipt.

Customer COD collections are not personal Driver earnings.
Existing Manager COD handover and settlement records remain separate.
Deposit balance is not automatically offset against COD settlements.

## Order messages

The implemented channel connects Drivers with Manager support.

It supports:

- Order selection.
- Persisted messages and message history.
- Sender and timestamp display.
- Quick-reply drafts.
- Duplicate-send protection.
- Older-message pagination.
- Driver polling while the dialog is open.
- Read-only conversations for closed deliveries.

Drivers can access messages only for their current assigned orders.
A reassigned Driver sees messages from their assignment time onward.

Messages are rendered as text, not executable HTML.
Saved messages are not external customer delivery or read receipts.

No customer account role or external customer messaging provider
is connected in this version.

## APIs

All APIs below require authenticated sessions.
Writes also require the existing X-CSRF-Token header.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /api/driver/profile | Current Driver profile |
| GET | /api/driver/orders | Latest 200 assigned delivery records |
| GET | /api/driver/orders/:id | Authorized delivery details |
| POST | /api/driver/orders/:id/accept | Start an existing assignment |
| POST | /api/driver/orders/:id/progress | Validated delivery progression |
| POST | /api/driver/orders/:id/proof | Upload delivery evidence |
| POST | /api/driver/location | Update own GPS location |
| GET | /api/driver/route-plan | Suggested stop sequence |
| GET | /api/driver/wallet | Balances, rewards and recent history |
| PUT | /api/driver/preferences | Save maximum delivery distance |
| POST | /api/driver/wallet/requests | Create withdrawal or top-up request |
| GET/POST | /api/driver/orders/:id/messages | Driver order messages |
| GET | /api/driver-support/wallet/requests | Latest 100 Manager review records |
| POST | /api/driver-support/wallet/requests/:id/review | Review a wallet request |
| GET | /api/driver-support/orders | Latest 200 assigned orders for support |
| GET/POST | /api/driver-support/orders/:id/messages | Manager order messages |

Wallet history returns the latest 50 entries and 50 requests.
Message history returns up to 50 messages per page and supports
the before cursor for older messages.

## Automated tests

Run the unit suites from backend:

```bash
npm ci

node --test \
  src/dss.test.js \
  src/manager-ai.test.js \
  src/driver-workspace.test.js
```

The configured suites contain:

- 5 DSS tests.
- 11 offline Manager AI tests.
- 5 Driver policy and routing tests.

The Driver integration suite contains 11 real HTTP/MySQL tests:

```bash
DRIVER_TEST_DB=local_driver_test \
DRIVER_TEST_HOST=127.0.0.1 \
DRIVER_TEST_PORT=33316 \
DRIVER_TEST_USER=root \
DRIVER_TEST_PASSWORD=your_test_database_password \
node --test src/driver-workspace.integration.cjs
```

Use a disposable local MySQL server for integration tests.
The suite drops and recreates its named test database and refuses
database names that do not end in _driver_test.
Never configure it to use deployed application data.

GitHub Actions runs:

1. JavaScript and inline HTML syntax checks.
2. DSS, offline Manager AI and Driver policy tests.
3. Driver API integration tests against a separate MySQL 8.4 service.

CI does not use production credentials or the deployed TiDB database.

## Verified user flows

Local Chromium checks covered actual API/database operations,
photo upload, payment filters, message rendering, error feedback
and layouts at 1366, 768, 390 and 320 px.

Deployment checks confirmed:

- Driver/Manager two-way order messages.
- GPS sharing and stopping.
- Completing DEMO-SCALE-O0101 credited 15,000 VND and 20 points.
- Rejected top-up left deposit balance unchanged.
- Pending withdrawal reserved funds.
- Rejected withdrawal restored available cash.

Browser checks are separate from the configured CI jobs.

## Integration boundaries

- No automated bank transfer or payment gateway.
- No external customer messaging integration.
- No live traffic or turn-by-turn navigation service.
- No automatic historical earnings or reward backfill.
- Delivery history and financial lists have explicit record limits.
- GPS rate limiting is per process, not a distributed rate limiter.
