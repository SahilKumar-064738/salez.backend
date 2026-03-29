# IVR/WhatsApp SaaS Backend — API Reference

> **Base URL:** `https://your-domain.com/api/v1`
>
> All responses follow the envelope: `{ success, data?, message?, meta?, error?, code? }`
>
> All timestamps are ISO 8601 with timezone offset (e.g. `2026-03-27T09:00:00Z`).

---

## Table of Contents

1. [Authentication & Headers](#1-authentication--headers)
2. [Auth Module](#2-auth-module)
3. [Contacts Module](#3-contacts-module)
4. [Messages Module](#4-messages-module)
5. [Campaigns Module](#5-campaigns-module)
6. [Calls / IVR Module](#6-calls--ivr-module)
7. [WhatsApp Accounts Module](#7-whatsapp-accounts-module)
8. [API Keys Module](#8-api-keys-module)
9. [Tenant Settings Module](#9-tenant-settings-module)
10. [Analytics Module](#10-analytics-module)
11. [Webhooks](#11-webhooks)
12. [Admin Module](#12-admin-module)
13. [Pagination](#13-pagination)
14. [Error Reference](#14-error-reference)
15. [Partitioned Tables](#15-partitioned-tables)

---

## 1. Authentication & Headers

### Request Headers

| Header | Used By | Format |
|---|---|---|
| `Authorization` | All JWT-protected routes | `Bearer <supabase_access_token>` |
| `X-API-Key` | API key authenticated routes | `sk_live_<hex64>` |
| `X-Tenant-Id` | Optional hint (informational only) | integer |

### Auth Methods

- **JWT (Bearer):** Obtain from `POST /auth/login`. Required for all routes unless noted.
- **API Key:** Use `X-API-Key` header with a key created via `POST /api-keys`. Scoped to specific operations.

---

## 2. Auth Module

### `POST /auth/register`

Create a new tenant and owner account. A tenant row, `user_profiles` entry, and default `tenant_settings` are created atomically.

**Auth:** None required

**Request Body**
```json
{
  "businessName": "Acme Corp",
  "email": "owner@acme.com",
  "password": "str0ngP@ss!",
  "displayName": "Jane Smith"
}
```

| Field | Type | Rules |
|---|---|---|
| `businessName` | string | 2–100 chars |
| `email` | string | valid email, unique across tenants |
| `password` | string | 8–72 chars |
| `displayName` | string | 2–80 chars |

**Response `201`**
```json
{
  "success": true,
  "data": {
    "user": { "id": "uuid", "email": "owner@acme.com" },
    "tenant": { "id": 1, "name": "Acme Corp", "slug": "acme-corp-a1b2c3", "plan": "free" },
    "accessToken": "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

**Errors:** `409` email already registered · `422` validation failed

---

### `POST /auth/login`

**Auth:** None required · Rate limited (10 req/min per IP)

**Request Body**
```json
{ "email": "owner@acme.com", "password": "str0ngP@ss!" }
```

**Response `200`**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJ...",
    "refreshToken": "eyJ...",
    "user": { "id": "uuid", "email": "owner@acme.com", "tenantId": 1, "role": "owner" }
  }
}
```

**Errors:** `401` invalid credentials · `403` account deactivated

---

### `POST /auth/refresh`

Exchange a refresh token for a new access token.

**Auth:** None required

**Request Body**
```json
{ "refreshToken": "eyJ..." }
```

**Response `200`** — same shape as login response

---

### `GET /auth/me`

**Auth:** Bearer JWT

**Response `200`**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "email": "owner@acme.com",
    "tenantId": 1,
    "role": "owner",
    "displayName": "Jane Smith",
    "isActive": true
  }
}
```

---

### `POST /auth/change-password`

**Auth:** Bearer JWT

**Request Body**
```json
{ "password": "newStr0ngP@ss!" }
```

**Response `200`** `{ "success": true, "message": "Password updated" }`

---

### `POST /auth/logout`

**Auth:** Bearer JWT

**Response `200`** `{ "success": true, "message": "Logged out" }`

---

## 3. Contacts Module

> **Auth:** Bearer JWT · All operations scoped to authenticated tenant.

### `GET /contacts`

List contacts with optional filters and cursor pagination.

**Query Parameters**

| Param | Type | Description |
|---|---|---|
| `stage` | enum | new, contacted, qualified, converted, lost |
| `search` | string | Matches name, phone, or email (max 100 chars) |
| `tag` | string | Filter by tag |
| `cursor` | string | Pagination cursor from previous response |
| `limit` | integer | 1–100, default 50 |

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "id": 42,
      "phone": "+15551234567",
      "name": "John Doe",
      "email": "john@example.com",
      "stage": "qualified",
      "notes": "Interested in enterprise plan",
      "tags": ["vip", "enterprise"],
      "created_at": "2026-01-15T10:00:00Z",
      "last_active": "2026-03-25T14:22:00Z"
    }
  ],
  "pagination": { "nextCursor": "eyJ...", "hasMore": true }
}
```

---

### `GET /contacts/pipeline-stats`

Contact counts grouped by funnel stage.

**Response `200`**
```json
{
  "success": true,
  "data": {
    "new": 340, "contacted": 220, "qualified": 85,
    "converted": 42, "lost": 67
  }
}
```

---

### `GET /contacts/:id`

**Response `200`** — full contact object with tags

**Errors:** `404` not found or belongs to another tenant

---

### `POST /contacts`

**Request Body**
```json
{
  "phone": "+15551234567",
  "name": "John Doe",
  "email": "john@example.com",
  "stage": "new",
  "notes": "Met at conference"
}
```

| Field | Type | Rules |
|---|---|---|
| `phone` | string | **Required.** 7–20 chars |
| `name` | string | Optional. max 150 chars |
| `email` | string | Optional. valid email |
| `stage` | enum | Optional. default `new` |
| `notes` | string | Optional. max 2000 chars |

**Response `201`** — full contact object

**Errors:** `409` phone already exists in tenant

---

### `PATCH /contacts/:id`

Partial update — only supplied fields are changed.

**Request Body**
```json
{ "stage": "qualified", "notes": "Follow up next week" }
```

**Response `200`** — updated contact object

---

### `DELETE /contacts/:id`

Soft delete (sets `deleted_at`). Contact is hidden from all list queries.

**Response `200`** `{ "success": true, "message": "Contact deleted" }`

---

### `POST /contacts/:id/tags`

Add a tag to a contact.

**Request Body**
```json
{ "tag": "vip" }
```

Tags must match `/^[a-z0-9_-]+$/i`, max 64 chars.

**Response `200`** — updated contact object

**Errors:** `409` tag already exists on contact

---

### `DELETE /contacts/:id/tags/:tag`

Remove a tag from a contact.

**Response `200`** `{ "success": true, "message": "Tag removed" }`

---

### `GET /contacts/:contactId/calls`

All calls linked to a contact, newest first.

**Query Parameters:** `cursor`, `limit` (1–100, default 20)

**Response `200`** — cursor-paginated list of call objects

---

## 4. Messages Module

> **Auth:** Bearer JWT

### `POST /messages/send`

Send a WhatsApp message to a contact. Queued via BullMQ — delivery is asynchronous.

**Request Body**
```json
{
  "contactId": 42,
  "whatsappAccountId": 3,
  "content": "Hello! Your appointment is confirmed for tomorrow at 10am.",
  "mediaUrl": "https://example.com/confirm.pdf",
  "mediaType": "application/pdf"
}
```

| Field | Type | Rules |
|---|---|---|
| `contactId` | integer | **Required** |
| `whatsappAccountId` | integer | **Required** |
| `content` | string | **Required.** 1–4096 chars |
| `mediaUrl` | string | Optional. valid URL |
| `mediaType` | string | Optional. MIME type, max 50 chars |

**Response `201`**
```json
{
  "success": true,
  "data": { "id": 9001, "status": "pending", "sent_at": "2026-03-27T12:00:00Z" },
  "message": "Message queued"
}
```

**Errors:** `404` contact or WhatsApp account not found · `422` validation failed

---

### `GET /messages/inbox`

Conversation summaries — one row per contact, showing latest message.

**Query Parameters**

| Param | Type | Description |
|---|---|---|
| `unreadOnly` | boolean | Default false |
| `cursor` | string | Pagination |
| `limit` | integer | 1–100, default 30 |

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "contact_id": 42,
      "contact_name": "John Doe",
      "contact_phone": "+15551234567",
      "contact_stage": "qualified",
      "last_message": "Thanks, see you tomorrow!",
      "last_direction": "inbound",
      "last_status": "read",
      "is_read": true,
      "last_message_at": "2026-03-27T11:55:00Z",
      "unread_count": 0
    }
  ],
  "pagination": { "nextCursor": "eyJ...", "hasMore": false }
}
```

---

### `GET /messages/conversation/:contactId`

All messages with a contact, newest first.

**Query Parameters:** `cursor`, `limit` (1–100, default 50)

**Response `200`** — cursor-paginated list of message objects

---

### `PUT /messages/conversation/:contactId/read`

Mark all messages in a conversation as read.

**Response `200`** `{ "success": true, "message": "Conversation marked as read" }`

---

## 5. Campaigns Module

> **Auth:** Bearer JWT

### Templates

#### `GET /campaigns/templates`

**Response `200`** — array of template objects

#### `GET /campaigns/templates/:id`

**Response `200`** — single template

#### `POST /campaigns/templates`

**Request Body**
```json
{
  "name": "Appointment Reminder",
  "content": "Hi {{name}}, your appointment is on {{date}} at {{time}}.",
  "variables": ["name", "date", "time"],
  "category": "utility"
}
```

| Field | Type | Rules |
|---|---|---|
| `name` | string | **Required.** 1–150 chars |
| `content` | string | **Required.** 1–4096 chars |
| `variables` | string[] | Variable placeholder names |
| `category` | enum | marketing, utility, authentication |

**Response `201`** — created template object

#### `PATCH /campaigns/templates/:id`

Partial update — any subset of create fields.

**Response `200`** — updated template

#### `DELETE /campaigns/templates/:id`

**Response `200`** `{ "success": true }`

---

### Campaigns

#### `GET /campaigns`

**Response `200`** — paginated list of campaigns

#### `GET /campaigns/:id`

**Response `200`** — campaign with recipient counts

#### `GET /campaigns/:id/recipients`

Paginated recipient delivery status.

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "contact_id": 42, "status": "delivered",
      "sent_at": "2026-03-25T09:00:00Z",
      "delivered_at": "2026-03-25T09:00:03Z"
    }
  ]
}
```

#### `POST /campaigns`

**Request Body**
```json
{
  "name": "Spring Promo",
  "templateId": 5,
  "whatsappAccountId": 3,
  "scheduledAt": "2026-04-01T09:00:00Z",
  "contactIds": [42, 43, 44],
  "filters": { "stage": "qualified", "tags": ["vip"] }
}
```

Either `contactIds` or `filters` selects recipients (or both — union).

**Response `201`** — campaign object with `status: "draft"`

#### `POST /campaigns/:id/send`

Trigger immediate send (or schedules if `scheduledAt` set). Dispatches BullMQ job.

**Response `200`** `{ "success": true, "message": "Campaign queued" }`

**Errors:** `409` campaign not in `draft` or `scheduled` status

#### `POST /campaigns/:id/cancel`

**Response `200`** `{ "success": true, "message": "Campaign cancelled" }`

**Errors:** `409` campaign already completed or failed

---

## 6. Calls / IVR Module

> **Auth:** Bearer JWT · All operations scoped to authenticated tenant.
>
> Calls are stored in **monthly partitioned tables** (`calls_2026_03`, etc.).
> Always query via the parent `calls` table — PostgreSQL routes automatically.

---

### `GET /calls`

List calls with cursor pagination.

**Query Parameters**

| Param | Type | Description |
|---|---|---|
| `status` | enum | initiated, ringing, in-progress, completed, busy, failed, no-answer, cancelled |
| `direction` | enum | inbound, outbound |
| `from_date` | ISO 8601 | Inclusive range start (uses partition pruning) |
| `to_date` | ISO 8601 | Inclusive range end |
| `contact_id` | integer | Filter to one contact's calls |
| `assigned_user_id` | UUID | Filter by assigned agent |
| `cursor` | string | Pagination cursor |
| `limit` | integer | 1–100, default 30 |

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "id": "CA1234567890abcdef",
      "tenant_id": 1,
      "direction": "inbound",
      "status": "completed",
      "from_number": "+15559876543",
      "to_number": "+15551234567",
      "started_at": "2026-03-27T09:00:00Z",
      "answered_at": "2026-03-27T09:00:05Z",
      "ended_at": "2026-03-27T09:04:32Z",
      "duration_seconds": 267,
      "cost": 0.0267,
      "cost_currency": "USD",
      "ivr_flow_id": "flow_support_v2",
      "contact_id": 42,
      "assigned_user_id": null,
      "created_at": "2026-03-27T09:00:00Z"
    }
  ],
  "pagination": { "nextCursor": "eyJ...", "hasMore": true }
}
```

---

### `GET /calls/stats`

Aggregated statistics for a date range. Joins `calls` + `call_metrics`.

**Query Parameters**

| Param | Type | Default |
|---|---|---|
| `from_date` | ISO 8601 | 30 days ago |
| `to_date` | ISO 8601 | now |
| `group_by` | day\|week\|month | — (no grouping) |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "total": 1420,
    "completed": 1280,
    "failed": 42,
    "noAnswer": 65,
    "busy": 33,
    "inbound": 890,
    "outbound": 530,
    "totalDurationSeconds": 341760,
    "avgDurationSeconds": 267,
    "totalCost": 142.50,
    "avgMosScore": 4.2,
    "avgTotalLatencyMs": 540
  }
}
```

---

### `POST /calls`

Create a call record. Use this when your telephony provider initiates a call and you need to track it.

**Auth:** Bearer JWT

**Request Body**
```json
{
  "id": "CA1234567890abcdef",
  "direction": "inbound",
  "from_number": "+15559876543",
  "to_number": "+15551234567",
  "status": "initiated",
  "contact_id": 42,
  "assigned_user_id": "uuid-of-agent",
  "ivr_flow_id": "flow_support_v2",
  "started_at": "2026-03-27T09:00:00Z"
}
```

| Field | Type | Rules |
|---|---|---|
| `id` | string | Optional. Use Twilio call SID or similar. Auto-generated if omitted (`call_<hex16>`). |
| `direction` | enum | **Required.** inbound \| outbound |
| `from_number` | string | **Required.** 5–30 chars |
| `to_number` | string | **Required.** 5–30 chars |
| `status` | enum | Optional. Default `initiated` |
| `contact_id` | integer | Optional. Links call to a contact |
| `assigned_user_id` | UUID | Optional. Agent UUID |
| `ivr_flow_id` | string | Optional. IVR flow identifier |
| `started_at` | ISO 8601 | Optional. Default server `now()` |

**Response `201`** — full call object

**Errors:** `409` call ID already exists · `422` validation failed

---

### `GET /calls/:id`

Fetch a single call by ID.

**Response `200`** — full call object

**Errors:** `404` call not found or belongs to another tenant

---

### `PATCH /calls/:id`

Update call status, timestamps, duration, or cost. Handles partitioned table updates correctly by looking up `started_at` before applying the change.

**Request Body** — at least one field required
```json
{
  "status": "completed",
  "answered_at": "2026-03-27T09:00:05Z",
  "ended_at": "2026-03-27T09:04:32Z",
  "duration_seconds": 267,
  "cost": 0.0267,
  "cost_currency": "USD"
}
```

| Field | Type | Rules |
|---|---|---|
| `status` | enum | Any valid call status |
| `answered_at` | ISO 8601 \| null | When call was answered |
| `ended_at` | ISO 8601 \| null | When call ended |
| `duration_seconds` | integer | ≥ 0 |
| `cost` | number | ≥ 0 |
| `cost_currency` | string | ISO 4217, 3 chars (e.g. `USD`) |
| `assigned_user_id` | UUID \| null | Re-assign or unassign agent |
| `contact_id` | integer \| null | Link or unlink contact |

**Response `200`** — updated call object

**Errors:** `404` call not found · `422` validation failed

---

### `GET /calls/:id/metrics`

Fetch AI voice quality metrics for a call.

**Response `200`**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "call_id": "CA1234567890abcdef",
    "stt_latency_ms": 120,
    "llm_latency_ms": 340,
    "tts_latency_ms": 80,
    "total_latency_ms": 540,
    "packet_loss": 0.005,
    "jitter_ms": 4.2,
    "bitrate_kbps": 64,
    "mos_score": 4.2,
    "recorded_at": "2026-03-27T09:00:30Z"
  }
}
```

Returns `data: null` if no metrics recorded for this call yet.

---

### `POST /calls/:id/metrics`

Store or update quality metrics. Upserts on `(call_id, tenant_id)` — subsequent calls replace the row.

`total_latency_ms` is auto-computed as `stt + llm + tts` if the individual components are provided but `total_latency_ms` is omitted.

**Request Body**
```json
{
  "stt_latency_ms": 120,
  "llm_latency_ms": 340,
  "tts_latency_ms": 80,
  "packet_loss": 0.005,
  "jitter_ms": 4.2,
  "bitrate_kbps": 64,
  "mos_score": 4.2
}
```

| Field | Type | Rules |
|---|---|---|
| `stt_latency_ms` | integer | Optional. Speech-to-text latency, ≥ 0 |
| `llm_latency_ms` | integer | Optional. LLM inference latency, ≥ 0 |
| `tts_latency_ms` | integer | Optional. Text-to-speech latency, ≥ 0 |
| `total_latency_ms` | integer | Optional. Override auto-computed total |
| `packet_loss` | float | Optional. 0.0–1.0 |
| `jitter_ms` | float | Optional. ≥ 0 |
| `bitrate_kbps` | integer | Optional. > 0 |
| `mos_score` | float | Optional. 1.0–5.0 (Mean Opinion Score) |
| `recorded_at` | ISO 8601 | Optional. Default server `now()` |

**Response `201`** — metrics object

---

### `GET /calls/:id/transcripts`

Paginated transcript segments ordered by audio position (`segment_start_ms` ascending).

**Query Parameters**

| Param | Type | Description |
|---|---|---|
| `speaker` | enum | agent \| customer \| system — filter by speaker |
| `cursor` | string | Pagination |
| `limit` | integer | 1–200, default 50 |

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "id": 501,
      "speaker": "customer",
      "content": "Hello, I need help with my account.",
      "confidence": 0.97,
      "word_count": 8,
      "segment_start_ms": 0,
      "segment_end_ms": 2340,
      "created_at": "2026-03-27T09:00:02Z"
    },
    {
      "id": 502,
      "speaker": "agent",
      "content": "Of course! I'd be happy to help. Can I get your account number?",
      "confidence": 0.99,
      "word_count": 13,
      "segment_start_ms": 2800,
      "segment_end_ms": 5100,
      "created_at": "2026-03-27T09:00:05Z"
    }
  ],
  "pagination": { "nextCursor": "eyJ...", "hasMore": true }
}
```

---

### `POST /calls/:id/transcripts`

Append a transcript segment. Inserts into the partitioned `call_transcripts` table. `word_count` is auto-computed from `content` if not supplied.

**Request Body**
```json
{
  "speaker": "customer",
  "content": "Hello, I need help with my account.",
  "confidence": 0.97,
  "segment_start_ms": 0,
  "segment_end_ms": 2340
}
```

| Field | Type | Rules |
|---|---|---|
| `speaker` | enum | **Required.** agent \| customer \| system |
| `content` | string | **Required.** 1–10000 chars |
| `confidence` | float | Optional. 0.0–1.0 (STT confidence score) |
| `word_count` | integer | Optional. Auto-computed if omitted |
| `segment_start_ms` | integer | Optional. Start offset in audio, ≥ 0 |
| `segment_end_ms` | integer | Optional. End offset in audio, ≥ 0 |
| `created_at` | ISO 8601 | Optional. Default server `now()` |

**Response `201`** — created transcript segment object

---

### `GET /calls/:id/events`

All lifecycle events for a call, ordered chronologically. Not paginated — typically fewer than 50 events per call.

**Response `200`**
```json
{
  "success": true,
  "data": [
    { "id": 1, "event_type": "call_initiated", "metadata": { "ivr_flow": "support_v2" }, "created_at": "2026-03-27T09:00:00Z" },
    { "id": 2, "event_type": "ringing",        "metadata": {},                            "created_at": "2026-03-27T09:00:01Z" },
    { "id": 3, "event_type": "answered",       "metadata": { "answered_by": "ivr" },     "created_at": "2026-03-27T09:00:05Z" },
    { "id": 4, "event_type": "ivr_menu",       "metadata": { "selection": "2" },         "created_at": "2026-03-27T09:00:12Z" },
    { "id": 5, "event_type": "hangup",         "metadata": { "hangup_cause": "normal" }, "created_at": "2026-03-27T09:04:32Z" }
  ]
}
```

---

### `POST /calls/:id/events`

Append a lifecycle event to a call. Inserts into the partitioned `call_events` table.

**Common event types:** `call_initiated`, `ringing`, `answered`, `ivr_menu_selected`, `dtmf_input`, `transfer_initiated`, `hold`, `resume`, `hangup`, `recording_started`, `recording_stopped`, `transcription_started`

**Request Body**
```json
{
  "event_type": "ivr_menu_selected",
  "metadata": { "menu_id": "main", "selection": "2", "option": "billing" },
  "created_at": "2026-03-27T09:00:12Z"
}
```

| Field | Type | Rules |
|---|---|---|
| `event_type` | string | **Required.** 1–100 chars |
| `metadata` | object | Optional. Any JSON object. Default `{}` |
| `created_at` | ISO 8601 | Optional. Default server `now()` |

**Response `201`** — created event object

---

### `GET /calls/:id/recording`

Recording metadata and presigned URL. Returns `404` if recording is soft-deleted or not found.

**Response `200`**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "call_id": "CA1234567890abcdef",
    "recording_url": "https://storage.example.com/recordings/CA1234.mp3",
    "duration_seconds": 267,
    "size_bytes": 2139136,
    "is_deleted": false,
    "created_at": "2026-03-27T09:05:00Z"
  }
}
```

Note: `storage_path` (internal bucket path) is never returned to the client.

---

### `POST /calls/:id/recording`

Store recording metadata. Upserts on `(call_id, tenant_id)` — one active recording per call.

**Request Body**
```json
{
  "recording_url": "https://storage.example.com/recordings/CA1234.mp3",
  "storage_path": "tenant_1/2026/03/CA1234.mp3",
  "duration_seconds": 267,
  "size_bytes": 2139136
}
```

| Field | Type | Rules |
|---|---|---|
| `recording_url` | string | **Required.** Valid URL |
| `storage_path` | string | Optional. Internal bucket path, max 500 chars |
| `duration_seconds` | integer | Optional. ≥ 0 |
| `size_bytes` | integer | Optional. ≥ 0 |

**Response `201`** — recording metadata object

---

## 7. WhatsApp Accounts Module

> **Auth:** Bearer JWT

### `GET /whatsapp-accounts`

**Response `200`** — array of WhatsApp account objects (API token never returned)

### `GET /whatsapp-accounts/:id`

**Response `200`** — single account object

### `POST /whatsapp-accounts`

**Request Body**
```json
{
  "phoneNumber": "+15551234567",
  "displayName": "Acme Support",
  "apiToken": "EAABsbC...",
  "provider": "meta",
  "dailyMessageLimit": 1000
}
```

| Field | Type | Rules |
|---|---|---|
| `phoneNumber` | string | **Required.** 7–20 chars |
| `apiToken` | string | **Required.** Encrypted at rest with AES-256-GCM |
| `provider` | enum | **Required.** meta \| twilio \| vonage \| wati |
| `displayName` | string | Optional. max 100 chars |
| `dailyMessageLimit` | integer | Optional. 1–100000, default 1000 |

**Response `201`** — account object

### `PATCH /whatsapp-accounts/:id`

**Request Body** — any subset of: `displayName`, `dailyMessageLimit`, `status` (active\|inactive), `apiToken`

**Response `200`** — updated account

### `DELETE /whatsapp-accounts/:id`

Sets status to `disconnected`. Non-destructive.

**Response `200`** `{ "success": true, "message": "Account disconnected" }`

---

## 8. API Keys Module

> **Auth:** Bearer JWT · Tenant-scoped.

### `GET /api-keys`

List all API keys for the tenant. `key_hash` is **never** returned.

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "Production IVR Key",
      "key_prefix": "sk_live_a1b2",
      "scopes": ["calls:read", "calls:write"],
      "is_active": true,
      "last_used_at": "2026-03-27T08:00:00Z",
      "expires_at": null,
      "created_at": "2026-01-01T00:00:00Z"
    }
  ]
}
```

---

### `GET /api-keys/:id`

**Response `200`** — single API key object (no `key_hash`)

---

### `POST /api-keys`

Create a new API key. The `raw_key` is returned **exactly once** — it cannot be retrieved again.

**Request Body**
```json
{
  "name": "Production IVR Key",
  "scopes": ["calls:read", "calls:write", "messages:write"],
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

| Field | Type | Rules |
|---|---|---|
| `name` | string | **Required.** 1–100 chars |
| `scopes` | string[] | Valid scope names. Default `["*"]` (wildcard) |
| `expiresAt` | ISO 8601 | Optional. Key becomes invalid after this date |

**Valid Scopes:** `*` · `contacts:read` · `contacts:write` · `messages:read` · `messages:write` · `campaigns:read` · `campaigns:write` · `calls:read` · `whatsapp:read` · `whatsapp:write` · `settings:read` · `settings:write`

**Response `201`**
```json
{
  "success": true,
  "data": {
    "id": 7,
    "name": "Production IVR Key",
    "key_prefix": "sk_live_a1b2",
    "raw_key": "sk_live_a1b2c3d4e5f6...",
    "scopes": ["calls:read", "calls:write"],
    "is_active": true,
    "expires_at": "2027-01-01T00:00:00Z",
    "created_at": "2026-03-27T00:00:00Z"
  },
  "message": "Save the raw_key now — it will not be shown again"
}
```

---

### `PATCH /api-keys/:id`

Update name, scopes, or expiry.

**Request Body** — any subset of: `name`, `scopes`, `expiresAt`

**Response `200`** — updated key object

---

### `DELETE /api-keys/:id`

Revoke a key (soft delete — sets `is_active: false`, `revoked_at: now`). Immediate effect.

**Response `200`** `{ "success": true, "message": "API key revoked" }`

---

### Using API Keys

Include the key in the `X-API-Key` header:

```http
GET /api/v1/calls
X-API-Key: sk_live_a1b2c3d4e5f6...
```

Middleware validates:
1. SHA-256 hash matches `api_keys.key_hash`
2. `is_active = true`
3. `expires_at` not past
4. Required scope is present (or `*` wildcard)
5. Updates `last_used_at` fire-and-forget

---

## 9. Tenant Settings Module

> **Auth:** Bearer JWT

### `GET /settings`

**Response `200`**
```json
{
  "success": true,
  "data": {
    "tenant_id": 1,
    "max_users": 5,
    "max_contacts": 1000,
    "max_whatsapp_accounts": 1,
    "max_campaigns": 10,
    "timezone": "America/New_York",
    "webhook_url": "https://hooks.example.com/ivr",
    "updated_at": "2026-03-01T00:00:00Z"
  }
}
```

---

### `PATCH /settings`

**Request Body** — any subset of:
```json
{
  "max_users": 10,
  "max_contacts": 5000,
  "timezone": "America/Chicago",
  "webhook_url": "https://hooks.example.com/ivr"
}
```

**Response `200`** — updated settings object

---

### `POST /settings/webhook-secret`

Rotate the HMAC secret used to sign outbound webhook payloads. The new secret is returned once.

**Response `200`**
```json
{
  "success": true,
  "data": { "webhook_secret": "new_secret_value" },
  "message": "Webhook secret rotated — update your receiver immediately"
}
```

---

## 10. Analytics Module

> **Auth:** Bearer JWT · All data scoped to authenticated tenant.

### `GET /analytics/calls`

Full call analytics summary for a date range.

**Query Parameters**

| Param | Type | Default |
|---|---|---|
| `from_date` | ISO 8601 | 30 days ago |
| `to_date` | ISO 8601 | now |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "period": { "from_date": "2026-02-25T00:00:00Z", "to_date": "2026-03-27T00:00:00Z" },
    "totals": {
      "calls": 1420, "completed": 1280, "failed": 42, "no_answer": 65,
      "busy": 33, "cancelled": 0, "inbound": 890, "outbound": 530
    },
    "duration": { "total_seconds": 341760, "avg_seconds": 267 },
    "cost": { "total": 142.50, "avg_per_call": 0.10 },
    "quality": {
      "avg_mos_score": 4.2,
      "avg_stt_latency_ms": 118.5,
      "avg_llm_latency_ms": 335.2,
      "avg_tts_latency_ms": 82.1,
      "avg_total_latency_ms": 535.8
    }
  }
}
```

---

### `GET /analytics/latency`

STT / LLM / TTS latency breakdown with percentiles.

**Query Parameters:** same as `/analytics/calls`

**Response `200`**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "call_id": "CA1234", "stt_latency_ms": 120, "llm_latency_ms": 340,
        "tts_latency_ms": 80, "total_latency_ms": 540, "mos_score": 4.2
      }
    ],
    "aggregates": {
      "sample_size": 1280,
      "stt_latency_ms":   { "avg": 118, "p50": 110, "p95": 210, "p99": 350 },
      "llm_latency_ms":   { "avg": 335, "p50": 320, "p95": 620, "p99": 890 },
      "tts_latency_ms":   { "avg": 82,  "p50": 78,  "p95": 140, "p99": 220 },
      "total_latency_ms": { "avg": 536, "p50": 510, "p95": 950, "p99": 1400 },
      "avg_mos_score": 4.2
    }
  }
}
```

---

### `GET /analytics/api-usage`

API request logs with per-endpoint breakdown.

**Query Parameters**

| Param | Type | Default |
|---|---|---|
| `from_date` | ISO 8601 | 7 days ago |
| `to_date` | ISO 8601 | now |
| `api_key_id` | integer | Optional — filter to one key |
| `limit` | integer | 1–1000, default 100 |

**Response `200`**
```json
{
  "success": true,
  "data": {
    "period": { "from_date": "...", "to_date": "..." },
    "summary": {
      "total_requests": 4820,
      "total_errors": 38,
      "error_rate": 0.79,
      "avg_response_ms": 142,
      "status_codes": { "200": 4720, "404": 22, "422": 16 }
    },
    "endpoints": [
      {
        "endpoint": "POST /api/v1/calls",
        "requests": 1240, "errors": 5,
        "error_rate": 0.40, "avg_response_ms": 88
      }
    ],
    "logs": [ ... ]
  }
}
```

---

## 11. Webhooks

> **Auth:** HMAC signature — NOT JWT. Signature must be verified before processing.

### `GET /webhooks/meta`

Meta webhook verification challenge (required by Meta before enabling a webhook URL).

**Query Parameters:** `hub.mode`, `hub.verify_token`, `hub.challenge`

**Response `200`** — returns `hub.challenge` as plain text if token matches

---

### `POST /webhooks/meta`

Receive inbound WhatsApp messages from Meta Business API.

**Headers:** `X-Hub-Signature-256: sha256=<hex>` (verified against `META_APP_SECRET`)

**Body:** Raw JSON (parsed after HMAC verification)

**Response `200`** — `{ "success": true }` (always — ack to Meta immediately, process async)

---

### `POST /webhooks/twilio`

Receive call status callbacks from Twilio.

**Headers:** `X-Twilio-Signature: <base64>` (verified against `TWILIO_AUTH_TOKEN`)

**Body:** `application/x-www-form-urlencoded`

**Response `200`** — TwiML or `{ "success": true }`

---

## 12. Admin Module

> **Auth:** Bearer JWT + `user_metadata.is_super_admin = true`
>
> Super-admin status is set directly in Supabase Auth (never via API).
> This is separate from tenant `user_profiles.role` — no tenant owner can access these endpoints.

### Stats

#### `GET /admin/stats`

Platform-wide aggregate counts.

**Response `200`**
```json
{
  "success": true,
  "data": {
    "activeTenants": 142,
    "activeUsers": 890,
    "totalContacts": 124500,
    "totalMessages": 3820000,
    "totalCampaigns": 4200
  }
}
```

---

### Users

#### `GET /admin/users`

**Query Parameters:** `page`, `limit` (max 100), `tenant_id`

**Response `200`** — paginated user list with `meta.total`

#### `GET /admin/users/:id`

**Response `200`** — full user profile

#### `PUT /admin/users/:id/role`

**Request Body:** `{ "role": "admin" }` (owner \| admin \| member \| viewer)

**Response `200`** — updated profile

#### `POST /admin/users/:id/deactivate`

Sets `is_active: false`. Existing sessions remain until expiry.

**Response `200`** `{ "success": true, "message": "User deactivated" }`

#### `DELETE /admin/users/:id`

Hard delete from auth.users. Cascades to user_profiles.

**Response `200`** `{ "success": true, "message": "User deleted" }`

---

### Tenants

#### `GET /admin/tenants`

**Query Parameters:** `page`, `limit`, `status` (active\|suspended\|deleted), `plan`

#### `GET /admin/tenants/:id`

#### `PATCH /admin/tenants/:id`

**Request Body:** `{ "name": "...", "plan": "pro" }`

#### `POST /admin/tenants/:id/suspend`

Sets `status: suspended`. Blocks new logins for all tenant users.

#### `POST /admin/tenants/:id/activate`

Re-activates a suspended tenant.

#### `DELETE /admin/tenants/:id`

Soft delete — sets `status: deleted`.

#### `GET /admin/tenants/:id/settings`

#### `PUT /admin/tenants/:id/settings`

Upsert tenant settings (max_users, limits, timezone, etc.)

---

### Contacts (Cross-Tenant)

#### `GET /admin/contacts`

All contacts across all tenants. **Query Parameters:** `page`, `limit`, `tenant_id`

#### `POST /admin/contacts/import`

Bulk import contacts into a tenant.

**Request Body**
```json
{
  "tenantId": 5,
  "contacts": [
    { "phone": "+15551234567", "name": "Jane Doe", "email": "jane@example.com" }
  ]
}
```

Max 10,000 contacts per request. Skips duplicates.

**Response `200`** — `{ "inserted": 980, "skipped": 20 }`

#### `DELETE /admin/contacts/all`

Truncate all contacts for a tenant. Requires `tenant_id` query param. Irreversible.

#### `DELETE /admin/contacts/:id/hard`

Hard delete a contact record (bypasses soft delete).

---

### Messages (Cross-Tenant)

#### `GET /admin/messages`

**Query Parameters:** `page`, `limit`, `tenant_id`

#### `DELETE /admin/messages/:id`

Hard delete a message record.

---

### Campaigns (Cross-Tenant)

#### `GET /admin/campaigns`

#### `DELETE /admin/campaigns/:id`

#### `POST /admin/campaigns/:id/force-send`

Trigger a campaign dispatch regardless of its current status.

#### `POST /admin/campaigns/:id/retry`

Retry failed recipients in a campaign.

---

### Calls (Cross-Tenant)

#### `GET /admin/calls`

**Query Parameters:** `page`, `limit`, `tenant_id`

Returns calls across all tenants for monitoring.

---

### API Keys (Cross-Tenant)

#### `GET /admin/api-keys`

**Query Parameters:** `page`, `limit`, `tenant_id`

#### `POST /admin/api-keys`

**Request Body**
```json
{
  "tenantId": 5,
  "name": "System Integration Key",
  "scopes": ["calls:read", "calls:write"],
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

**Response `201`** — key object including `raw_key` (shown once)

#### `DELETE /admin/api-keys/:id`

Revoke any API key across any tenant.

---

### Logs

#### `GET /admin/logs`

Admin audit log — all actions taken by super-admins.

**Query Parameters:** `page`, `limit`, `user_id`, `tenant_id`, `action`

**Response `200`**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "user_id": "uuid",
      "tenant_id": 5,
      "action": "suspend_tenant",
      "method": "POST",
      "path": "/admin/tenants/5/suspend",
      "ip_address": "1.2.3.4",
      "created_at": "2026-03-27T10:00:00Z"
    }
  ],
  "meta": { "total": 840 }
}
```

#### `GET /admin/api-logs`

Raw API request logs from the `api_logs` partitioned table.

**Query Parameters:** `page`, `limit`, `tenant_id`, `status_code`

#### `GET /admin/login-attempts`

Login attempt history for security monitoring.

**Query Parameters:** `page`, `limit`, `email`, `tenant_id`, `success` (boolean)

---

### Dynamic DB (Escape Hatch)

⚠️ **For debugging only. Never expose to untrusted clients.**

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/admin/db/tables` | List all public tables |
| `GET` | `/admin/db/:table` | Query any table (supports `page`, `limit`) |
| `POST` | `/admin/db/:table` | Insert a row |
| `PUT` | `/admin/db/:table/:id` | Update a row by `id` |
| `DELETE` | `/admin/db/:table/:id` | Delete a row by `id` |
| `DELETE` | `/admin/db/truncate/:table` | Truncate a table |
| `DELETE` | `/admin/db/reset` | Reset the entire DB (dev only) |

---

## 13. Pagination

### Cursor Pagination

Used by: `GET /calls`, `GET /contacts`, `GET /messages/*`, `GET /calls/:id/transcripts`

```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "nextCursor": "eyJpZCI6bnVsbCwidGltZXN0YW1wIjoiMjAyNi0wMy0yN1QwOTowMDowMFoifQ",
    "hasMore": true
  }
}
```

Pass `nextCursor` as the `cursor` query parameter in the next request. Cursors are opaque base64url-encoded JSON `{ id, timestamp }` values. They expire with the underlying data — always re-fetch if stale.

### Offset Pagination

Used by: all `/admin/*` endpoints

```json
{
  "success": true,
  "data": [ ... ],
  "meta": { "total": 4200 }
}
```

Use `page` (default 1) and `limit` (default 20, max 100) query parameters.

---

## 14. Error Reference

All errors follow this envelope:
```json
{
  "success": false,
  "error": "Human-readable description",
  "code": "MACHINE_READABLE_CODE",
  "statusCode": 404,
  "details": [ { "path": "body.email", "message": "Invalid email" } ]
}
```

| HTTP | Code | Cause |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed request |
| 401 | `UNAUTHORIZED` | Missing/invalid/expired token or API key |
| 403 | `FORBIDDEN` | Insufficient role or scope |
| 404 | `NOT_FOUND` | Resource doesn't exist, or belongs to another tenant |
| 409 | `CONFLICT` | Duplicate entry, or invalid state transition |
| 409 | `DUPLICATE_ENTRY` | Unique constraint violation in DB |
| 422 | `VALIDATION_ERROR` | Zod schema validation failed (includes `details` array) |
| 422 | `INVALID_REFERENCE` | Foreign key reference doesn't exist |
| 429 | `RATE_LIMIT` | Too many requests |
| 500 | `INTERNAL_ERROR` | Server error |

---

## 15. Partitioned Tables

Several high-volume tables are **range-partitioned by time** in PostgreSQL. Always query via the **parent table** — PostgreSQL automatically routes reads and writes to the correct partition.

| Parent Table | Partition Strategy | Example Partition |
|---|---|---|
| `calls` | Monthly by `started_at` | `calls_2026_03` |
| `call_events` | Monthly by `created_at` | `call_events_2026_03` |
| `call_transcripts` | Monthly by `created_at` | `call_transcripts_2026_03` |
| `api_logs` | Quarterly by `created_at` | `api_logs_2026_q1` |
| `messages` | Monthly by `sent_at` | `messages_2026_03` |
| `contacts` | Hash by `tenant_id` (8 buckets) | `contacts_p0` – `contacts_p7` |

**Performance tip:** Always include a date range filter (`from_date` / `to_date`) when querying time-partitioned tables. This enables **partition pruning** and can cut query time by 95%+ on large datasets.

**Composite PKs:** `calls`, `call_events`, `call_transcripts`, `api_logs`, and `messages` have composite primary keys that include the partition column (e.g. `(id, started_at)`). The `PATCH /calls/:id` endpoint handles this correctly — it fetches `started_at` before updating to satisfy PostgreSQL's routing requirement.

---

*Generated for ivr-whatsapp-saas-backend v2.1.0*