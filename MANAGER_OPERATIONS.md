# Manager Operations

## Scope

This update adds:

- Hanoi operating zone management.
- Near-real-time Driver GPS tracking for Managers.
- Successful login audit emails.
- Authenticated order import with duplicate protection.

Base branch: `feature/fleet-dispatch-dss`.

Working branch: `feature/manager-operations`.

The Driver mobile interface, wallet, chat and delivery controls
must remain compatible.

## Configuration

Use environment variables for real configuration.
Never commit `.env`, passwords, API keys or integration tokens.

| Variable | Purpose |
| --- | --- |
| `MANAGER_LOGIN_EMAIL` | Manager recipient for successful login notifications |
| `ORDER_IMPORT_TOKEN` | Dedicated integration secret, 32–512 characters |
| `ORDER_IMPORT_SOURCE` | Import source label; defaults to `integration` |
| `GPS_FRESHNESS_SECONDS` | GPS freshness window, 15–300 seconds; defaults to 60 |
| `BREVO_API_KEY` | Existing Brevo transactional email key |
| `EMAIL_FROM` | Existing verified sender address |
| `EMAIL_FROM_NAME` | Existing sender display name |
| `APP_PUBLIC_URL` | Application origin, without a page path |
| `TRUST_PROXY` | Existing Express reverse-proxy configuration |

Source labels must contain 1–64 ASCII letters, digits,
underscores or hyphens.

Set `TRUST_PROXY=1` only when the application runs behind the
expected trusted reverse proxy. Login IP addresses use Express
`req.ip`.

## Migration

Migration file:

`backend/migrations/021-manager-operations.js`

Manual runner:

`backend/scripts/migrate-manager-operations.js`

The migration never runs automatically during server startup.

After explicitly selecting a disposable test database, run
from `backend/`:

```bash
npm run migrate:manager-operations
```

Do not run this command against an operational database during
development verification.

The migration:

- Adds stable codes for 12 Hanoi business zones.
- Preserves existing matching zone IDs and relationships.
- Adds GPS sharing flags and hashed session identifiers.
- Adds `orders.external_order_id` and `orders.import_source`.
- Adds the unique index `uq_orders_external_order_id`.
- Checks existing external IDs for normalization collisions
  before changing schema or data.
- Reports duplicate IDs and stops without deleting or merging orders.
- Checks existing columns and indexes so it can be rerun.

Database DDL may commit independently. If a migration stops,
resolve the reported issue before rerunning it.

Hanoi coordinates are approximate business-zone centroids,
not administrative boundary polygons.

## Operating Zones

Manager-only endpoints:

- `GET /api/fleet/zone-summary`
- `PUT /api/fleet/drivers/:id/zone`

Example transfer body:

```json
{
  "zone_id": 3
}
```

Transfers require an existing driver and an active destination zone.
Protected write requests require the existing session and CSRF token.

On-duty counts use `drivers.status = 'available'`.
They do not depend on GPS sharing.

A transfer changes the driver's operating zone, not existing orders.
Previously assigned orders retain their driver, zone and status.

Existing assignments can still start after a transfer, subject
to the order's original zone being active and the remaining
ownership, vehicle, payload and delivery checks.

Future dispatch recommendations use the new operating zone.

## Live GPS Tracking

Driver endpoints:

- `POST /api/driver/location/sharing`
- `POST /api/driver/location`

Enable sharing:

```json
{
  "enabled": true
}
```

The response contains a fresh `sharing_token`.
The Driver includes this token in subsequent location updates.

Stop sharing:

```json
{
  "enabled": false,
  "sharing_token": "<current sharing token>"
}
```

Tokens are stored as hashes and are not returned by Manager APIs.

Manager endpoint:

`GET /api/fleet/tracking`

The endpoint returns only valid coordinates from the enabled
sharing session within the configured freshness window.

In Dispatch, select **Start live GPS tracking**.

Tracking:

- Polls every four seconds.
- Skips overlapping requests.
- Updates markers by Driver ID.
- Preserves map zoom and open popups during updates.
- Removes stopped or expired GPS markers.
- Shows a disconnected state and retries after API failures.
- Stops polling when the page is hidden or left.

Operational status priority:

1. `Delivering`: at least one order is in progress.
2. `Idle`: available with no active orders.
3. `Online`: available with assigned orders but none delivering.
4. `Offline`: otherwise.

Operational status and GPS freshness are separate.

Logout disables GPS sharing. Leaving the Driver page attempts
a stop request; freshness expiry handles failed stop requests
or network loss.

Reload Driver pages after the updated GPS protocol is deployed.
GPS requires HTTPS or localhost and browser location permission.
Background tracking is not guaranteed.

## Login Audit Emails

A successful Manager or Driver login notifies the configured
Manager and preserves the personal login notification.

Recipients are normalized and deduplicated per login event.
A Manager whose account email matches `MANAGER_LOGIN_EMAIL`
receives only one email for that event.

Messages include:

- Account role.
- Full name and account email.
- Time in `Asia/Ho_Chi_Minh`.
- IP from Express `req.ip`.
- Browser and operating system inferred from User-Agent.

The existing Brevo service uses a 15-second request timeout.
Sending runs in the background.

Email failures do not change a successful login response.
Missing configuration and send failures produce structured logs.
Passwords, tokens and API keys must never appear in emails or logs.

## Automatic Order Import

Endpoint:

`POST /api/integrations/orders`

Required header:

```text
Authorization: Bearer <ORDER_IMPORT_TOKEN>
```

Integration authentication is separate from application sessions.

Payload `order_id` maps to `orders.external_order_id`.
The internal primary key `orders.id` remains unchanged.

External IDs are trimmed, converted to uppercase and restricted
to 1–128 ASCII letters, digits, underscores or hyphens.

External IDs are globally unique across source labels.
Source systems with overlapping IDs must provide a namespace
within their IDs.

The server generates a separate local `order_code`.
The source label comes from `ORDER_IMPORT_SOURCE`.

Example payload:

```json
{
  "order_id": "PARTNER-000123",
  "customer_name": "Synthetic Customer",
  "customer_phone": "0901234567",
  "delivery_address": "Synthetic Hanoi delivery address",
  "restaurant_id": 1,
  "latitude": 21.029,
  "longitude": 105.855,
  "weight_kg": 1,
  "delivery_fee": 15000,
  "payment_method": "cash",
  "due_at": "2030-01-01T12:00:00+07:00",
  "items": [
    {
      "item_name": "Synthetic meal",
      "quantity": 1,
      "unit_price": 50000
    }
  ]
}
```

Use an existing restaurant ID and a future deadline.

Manual creation and import share the same validation and
transaction service. Totals and COD are calculated on the server.

| HTTP | Outcome |
| --- | --- |
| 201 | `created` |
| 200 | `duplicate_ignored` |
| 400 | `invalid_payload` |
| 401 | `unauthorized` |
| 503 | `unavailable` |
| 500 | `system_error` |

A known external ID returns the existing order without overwriting it,
even if its old deadline has passed.

For concurrent requests, the database unique constraint is authoritative.
Only a duplicate violation of `uq_orders_external_order_id` is ignored.

The Orders list displays the import source and external ID beneath
the local order code. Manual orders display **Manual entry**.

## Verification Checklist

Record actual results after running the checks.

- Manager APIs reject Driver access.
- Zone transfers preserve assigned and in-progress deliveries.
- On-duty counts remain independent of GPS.
- Live polling preserves marker identity, zoom and popup state.
- Stopped or expired GPS markers disappear.
- Tracking retries after connection failures.
- Email failures do not block login.
- Login recipients are deduplicated.
- Invalid webhook credentials and payloads are rejected.
- Repeated and concurrent source IDs create exactly one order.
- Duplicate preflight stops without deleting existing data.
- Migration reruns preserve existing zone relationships.
- Driver wallet, chat and delivery progression remain functional.

Do not automatically merge, deploy to Render or migrate
the operational database.
