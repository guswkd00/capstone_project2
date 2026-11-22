# Manager Operations Implementation Plan

## Working Rules

- Provide instructions in Vietnamese.
- Write repository content, code comments and UI labels in English.
- Complete one step at a time.
- Mark a step complete only after the user confirms “DONE” or “XONG”.
- Locally prepared code does not count as completed GitHub work.
- Base branch: feature/fleet-dispatch-dss.
- Working branch: feature/manager-operations.
- Preserve compatibility with the Driver mobile interface.
- Do not automatically merge or deploy to Render.
- Run development migrations only against a disposable test database.
- Never commit passwords, tokens or API keys.

## Progress

Completed: 1/18 steps.

Current step: 02 — Add and commit PLAN.md.

- [x] 01. Create or select feature/manager-operations and open GitHub.dev.
- [ ] 02. Add PLAN.md at the repository root and commit the plan.
- [ ] 03. Add order-import-policy.js for source ID normalization and webhook authentication.
- [ ] 04. Add migration 021-manager-operations and its manual runner.
- [ ] 05. Add order-service.js and share validation between manual and imported orders.
- [ ] 06. Add order-import.js and register the import API in server.js.
- [ ] 07. Add Manager zone APIs and handle drivers without an operating zone.
- [ ] 08. Add GPS sharing sessions and preserve existing deliveries after zone transfers.
- [ ] 09. Update Driver GPS sharing and the script version.
- [ ] 10. Add Manager login audit emails with recipient deduplication.
- [ ] 11. Add zone management UI to Fleet & Data and Dispatch.
- [ ] 12. Add Manager live GPS tracking with four-second polling.
- [ ] 13. Display import sources and external order IDs in Orders.
- [ ] 14. Update configuration examples, npm scripts and documentation.
- [ ] 15. Add unit, integration and browser tests, and update CI.
- [ ] 16. Run tests and migrations against a disposable test database.
- [ ] 17. Verify the Manager and Driver interfaces.
- [ ] 18. Review changes and create a draft pull request without merging or deploying.

## Acceptance Criteria

- Drivers cannot access Manager-only APIs.
- Zone transfers preserve existing order assignments.
- Drivers can continue existing deliveries after a zone transfer.
- On-duty counts are independent of GPS sharing.
- Tracking requests do not overlap.
- Live marker updates preserve marker identity, map zoom and open popups.
- Markers disappear when sharing stops or coordinates expire.
- Tracking failures display a disconnected state and retry automatically.
- Email failures do not block successful login.
- Each login event sends at most one email per recipient.
- The webhook uses dedicated integration credentials.
- Repeated or concurrent requests with the same source ID create only one order.
- Migration duplicate checks stop without deleting or merging existing data.
- Driver wallet, chat and delivery progression remain functional.

## Confirmation Log

- 2026-11-22: The user confirmed completion of Step 01.
