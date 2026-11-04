# ServiceOS — REST API Reference

Base path (sandbox): same-origin through the platform gateway — every request carries
`?XTransformPort=4000`; in conventional deployments the API is reached at its own host.
Interactive OpenAPI: `/api/docs` (enabled when `ENABLE_SWAGGER=true`, default in dev).

## 1. Conventions (Tech Spec §10)

- **Envelope** — success: `{ "data": <payload>, "meta": { "requestId": "<uuid>" } }`;
  list responses add `"page": { "nextCursor": string | null, "hasMore": boolean }` when
  the underlying query is cursor-paginated.
- **Errors** — `{ "error": { "code": "<MACHINE_CODE>", "message": "<human>",
  "details": [{ "field", "reason" }]? }, "meta": { "requestId" } }`. Machine codes are
  stable contracts (e.g. `VALIDATION_FAILED`, `TOKEN_EXPIRED`, `VERSION_CONFLICT`,
  `WORK_ORDER_INVALID_TRANSITION`, `CHECKLIST_INCOMPLETE`, `ACKNOWLEDGEMENT_REQUIRED`,
  `NOT_ASSIGNED`, `DUPLICATE`, `NOT_FOUND`).
- **Validation** — class-validator DTOs, `whitelist + forbidNonWhitelisted`; unknown
  fields are rejected, not ignored.
- **Optimistic concurrency** — mutations accept `expectedVersion`; a stale version
  returns `409 VERSION_CONFLICT` (§22.1).
- **Idempotency** — mobile sync operations carry client-generated `operationId`
  (UUID); replays return `duplicate` with the original outcome.
- **Money** — `amountMinor` (bigint minor units, serialized as string) +
  `currencyCode` (ISO-4217). **Timestamps** — ISO-8601 UTC; tenant/site IANA timezone
  names drive local rendering.
- **Auth** — `Authorization: Bearer <accessToken>` (15-min JWT). `X-Tenant-Id` is an
  optional hint for multi-tenant users and is always validated against membership.
- **Rate limits** — login 10/min, refresh 30/min per IP (HTTP 429 with Retry-After).

## 2. Endpoint catalog (75 routes)

### Auth & session
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/auth/register` | Create account + org, or accept an invitation (`invitationToken`) |
| POST | `/api/v1/auth/login` | Sets rotating refresh cookie (`serviceos_rt`, httpOnly, path `/api/v1/auth`) |
| POST | `/api/v1/auth/refresh` | Rotate cookie → new access token; reuse detection revokes the session family |
| POST | `/api/v1/auth/logout` | Revoke refresh session |
| GET | `/api/v1/auth/me` | Profile + memberships **+ permissions** (login/refresh omit permission arrays) |
| POST | `/api/v1/auth/switch-tenant` | Re-issue access token for another membership |

### Tenancy & team
| Method | Path | Notes |
| --- | --- | --- |
| GET/PATCH | `/api/v1/tenants/current` | Workspace settings (name, timezone, locale, currency) |
| GET/POST | `/api/v1/team/members` · `/api/v1/team/invitations` | Members carry skills for assignment matching |
| PATCH | `/api/v1/team/members/{userId}` | Role/status/skills changes |
| POST/DELETE | `/api/v1/team/invitations/{id}/resend` · `{id}` | Invitation lifecycle |

### CRM & installed base
| Method | Path | Notes |
| --- | --- | --- |
| GET/POST | `/api/v1/customers` | Search `?search=`, `?status=`; duplicate guard on account code |
| GET | `/api/v1/customers/duplicates?legalName=` | Pre-create duplicate warning |
| GET/PATCH/DELETE | `/api/v1/customers/{id}` | Soft delete; `expectedVersion` |
| POST/DELETE | `/api/v1/customers/{id}/contacts[/{contactId}]` | Primary-contact invariant enforced |
| GET/POST | `/api/v1/sites` | `?customerId=`, `?search=`; timezone + access instructions |
| GET/POST | `/api/v1/assets` | `?search=`, `?family=`, `?siteId=`, `?customerId=`, `?status=`; nameplate JSONB validated per family |
| GET | `/api/v1/assets/{id}/timeline` | Chronological service history |
| GET | `/api/v1/assets/{id}/qr` | `{ assetCode, url, qrSvg }` nameplate payload |
| POST | `/api/v1/assets/{id}/documents` | Link uploaded file as SLD / GA / test cert / manual… |

### Service desk (Workflow B)
| Method | Path | Notes |
| --- | --- | --- |
| GET/POST | `/api/v1/service-requests` | `?status=`, `?severity=`, `?customerId=`, `?assetId=`, `?search=` |
| POST | `/{id}/triage` | Adjust severity/category, mark duplicate |
| POST | `/{id}/accept` · `/{id}/request-information` · `/{id}/reject` | Reason mandatory on reject |
| PATCH | `/{id}/close` | Close without work order |
| POST | `/{id}/convert` | Create work order; uncovered service requires `coverageOverrideReason` |

### Work orders (Workflow C)
| Method | Path | Notes |
| --- | --- | --- |
| GET/POST | `/api/v1/work-orders` | Technicians automatically see only their own; `?status=`, `?assignedTo=`, `?overdue=true`, `?search=` |
| GET | `/api/v1/work-orders/my` | Bounded job-pack query for the technician client |
| POST | `/{id}/assignments` | Offer to technician (skills matched in UI) |
| POST | `/{id}/transitions` | State machine `draft→ready→scheduled→in_progress→pending_review→completed→closed` (+`on_hold`, `cancelled`); reasons mandatory for hold/cancel |
| POST | `/{id}/checklist` | Outcome per item (`pass|fail|not_applicable|exception`); measurements require values; exceptions require reasons |
| POST | `/{id}/measurements` · `/{id}/observations` · `/{id}/parts` | Field execution evidence |
| POST | `/{id}/completion` | Completion summary — prerequisite for `pending_review` |
| POST | `/{id}/acknowledgement` | Customer acknowledgement (signature / name confirmation / documented refusal) |
| POST | `/{id}/service-reports` | Generate versioned PDF snapshot |
| POST | `/api/v1/work-orders/reports/{id}/approve` · `/publish` | Review lifecycle; corrections = new superseding version |

### Contracts & maintenance (Workflow D)
| Method | Path | Notes |
| --- | --- | --- |
| GET/POST | `/api/v1/service-contracts` | warranty/AMC/service with per-asset coverage types; `?type=`, `?status=`, `?renewalStatus=` |
| GET | `/api/v1/service-contracts/renewals?days=90` | Renewal pipeline |
| POST | `/{id}/renew` | Successor contract; old one marked renewed |
| GET/POST | `/api/v1/checklist-templates` · `/{id}/versions` | Versioned immutable definitions (JSONB schema v1) |
| GET/POST | `/api/v1/maintenance-plans` · `/{id}/preview` · `/{id}/generate` | Recurrence rules; generation is idempotent per (plan, asset, dueAt) |
| GET | `/api/v1/planned-visits` | `?status=` calendar feed |

### Mobile sync (§8.5 — PWA/native contract)
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/mobile/job-packs` | Assigned, **bounded** dataset incl. checklist definitions. `?limit=` (server-capped at 200, default 100) and `?since=` ISO cursor → incremental delta on `work_orders.updated_at`; response: `{ syncedAt, since, nextSince, hasMore, limit, jobs }` |
| POST | `/api/v1/mobile/sync/push` | `{ deviceId, mutations[] }` (max 500) → per-operation `accepted|duplicate|pending|conflict|rejected`. Idempotency is **atomic**: the operation row is claimed by INSERT before applying — concurrent duplicates apply exactly once |
| GET | `/api/v1/mobile/sync/status?deviceId=` | `{ cursor, lastSyncAt, lastOperations[], summary }` for diagnostics |

### Files, notifications, audit, analytics
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/files` | Multipart `file`; MIME sniffed from bytes; **malware-scanned before persistence (fail-closed)**; SHA-256 checksum; `?ownerType=&ownerId=`; 30/min |
| GET | `/api/v1/files/{id}/download-url` | Short-lived signed URL after **role + object-level** authorization (technicians: own uploads / assigned work-order files only) |
| GET | `/api/v1/files/download/{token}?sig=` | Public-by-signature stream (S3-presigned semantics); scan-clean only; `X-Content-Type-Options: nosniff` |
| GET | `/api/v1/notifications` · `/unread-count` · `/{id}/read` · `/read-all` | In-app notification centre (reminders deduplicated per user+key) |
| GET | `/api/v1/audit-events` | `?action=`, `?resourceType=`, `?actorUserId=` (incl. `file.download_denied`, `file.rejected_malware`) |
| GET | `/api/v1/analytics/overview` · `/analytics/service?days=30` | Live aggregates only |

### Health & monitoring
| Method | Path | Notes |
| --- | --- | --- |
| GET | `/health/live` | Process liveness |
| GET | `/health/ready` | Dependency readiness (database + configured storage driver) |
| GET | `/health/worker` | Background-worker heartbeat: `{ status, workerId, lastOutboxPollAt, lastPmPassAt, lastRenewalPassAt, outboxPollAgeSeconds, healthy }` — healthy within 3× `WORKER_POLL_MS` |

### Rate limits

Global `THROTTLE_LIMIT`/`THROTTLE_TTL_MS` (default 300/min; authenticated
requests keyed per user id, anonymous per client IP); login/register 10/min,
refresh 30/min, file upload 30/min, sync push 120/min. Exceeded → `429`
`RATE_LIMITED` in the standard envelope.

## 3. Checklist definition schema v1

```json
{
  "schemaVersion": 1,
  "items": [
    {
      "key": "busbar_temp_c",           // lower_snake_case, unique
      "label": "Busbar temperature at full load",
      "type": "check | measurement | informational",
      "required": true,
      "unit": "°C",                      // mandatory for measurements
      "minValue": 0, "maxValue": 90,     // optional accepted range
      "instructions": "Measure after 1h at rated load"
    }
  ]
}
```

Definitions are validated at the API boundary and **immutable once a version exists**;
work orders snapshot the exact `checklistTemplateVersionId` (ADR-018).
