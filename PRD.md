# PRD: AI-Powered RFQ Data Extraction System — Backend

## 1. Product Overview

### 1.1 Purpose

A backend system for managing Request for Quotation (RFQ) workflows in a manufacturing/industrial procurement context. The system provides APIs to manage an Item Master (product catalog), create and track RFQs from vendors, and manage line items with per-RFQ pricing and technical specifications.

### 1.2 Target Users

| Role | Description |
|------|-------------|
| **Owner** (`ROLE_OWNER`) | Full system access — top-level control, user management |
| **Admin** (`ROLE_ADMIN`) | Administrative access — user management, all CRUD operations |
| **Office Staff** (`ROLE_OFFICE_STAFF`) | Office operations — RFQ management, data entry, reporting |
| **Field Staff** (`ROLE_FIELD_STAFF`) | Field operations — view RFQs, submit field data |

### 1.3 Problem Statement

Manual RFQ processing is error-prone and slow. Vendor quotations arrive in varied formats (PDFs, spreadsheets, emails). Each quotation must be matched against a master item catalog, pricing captured, and technical specifications validated. Without a centralized system:

- Item data is duplicated across quotations
- Historical pricing is lost
- No audit trail of vendor interactions
- No structured data for AI-powered extraction and analysis

---

## 2. Core Data Model

### 2.1 Three-Entity Architecture

```
+------------------+       +------------------+       +---------------------+
|   ITEM MASTER    |       |       RFQ        |       |   RFQ LINE ITEMS    |
|   (items)        |       |      (rfqs)      |       |    (rfqitems)       |
+------------------+       +------------------+       +---------------------+
| itemCode (unique)|       | prNumber (unique)|       | item (→ Item)       |
| itemName         |       | startDate        |       | quantity            |
| itemDesc         |       | dueDate          |       | drawingNumber       |
| itemType         |       | ownerName        |       | drawingUrl          |
| size             |       | companyName      |       | itemTechSpecs (→)   |
| isDeleted        |       | location         |       | commercialSpecs (→) |
+------------------+       | status           |       | isDeleted           |
                           | isQuoted         |       +---------------------+
                           | deliveryWeeks    |
                           | items[] (→ RFQ   |
                           |   Line Items)    |
                           | isDeleted        |
                           +------------------+
```

### 2.2 Supporting Entities

- **ItemTechSpecs** (`itemtechspecs`) — material, diameter, length, weight, bore, thickness, thread details, grade
- **CommercialSpecs** (`commercialspecs`) — currency, raw material cost, labor cost, profit margin, total cost, packing, shipping, selling price, other costs
- **User** (`users`) — authentication, role-based access control

### 2.3 Design Principles (from RFQ_Database_Design_Reference.pdf)

1. **Item Master is the permanent reference library** — one entry per unique item code, rarely changes
2. **RFQ is the container** — represents a single vendor quotation request with lifecycle status
3. **RFQ Line Items capture per-RFQ snapshots** — quantity, pricing, and technical overrides without altering master data
4. **Historical tracking** — same item can appear in multiple RFQs, each with its own pricing snapshot
5. **No duplication** — item data lives in the master; line items reference it

---

## 3. Functional Requirements

### 3.1 User Management

| ID | Feature | Status | Description |
|----|---------|--------|-------------|
| U-1 | User Registration | Done | Create account with role assignment |
| U-2 | User Login | Done | Email + password auth, returns JWT tokens |
| U-3 | Token Refresh | Done | Refresh expired access tokens |
| U-4 | Logout | Done | Invalidate refresh token, clear cookies |
| U-5 | View Profile | Done | Get current authenticated user's profile |
| U-6 | Update Profile | Done | Modify user details (not password) |
| U-7 | Change Password | Done | Requires current password verification |
| U-8 | List All Users | Partial | Admin-only endpoint (needs full implementation) |

### 3.2 Item Master Management

| ID | Feature | Status | Description |
|----|---------|--------|-------------|
| I-1 | Create Item | Done | Add new item with code, name, description, type |
| I-2 | Get Item by Code | Done | Lookup single item by itemCode |
| I-3 | List All Items | Done | Get all active (non-deleted) items |
| I-4 | Update Item | Done | Modify item details by itemCode |
| I-5 | Soft Delete Item | Done | Mark as deleted (preserves data) |
| I-6 | Restore Item | Done | Undo soft delete |
| I-7 | Hard Delete Item | Done | Permanent removal (only if unreferenced by RFQs) |

### 3.3 RFQ Management

| ID | Feature | Status | Description |
|----|---------|--------|-------------|
| R-1 | Create RFQ | Done | New RFQ with PR number, company, dates, items |
| R-2 | List All RFQs | Done | Get all RFQs (active) |
| R-3 | Get RFQ by ID | Done | Single RFQ with populated references |
| R-4 | Delete RFQ | Done | Soft delete |
| R-5 | Upload RFQ File | Done | Attach document (via Cloudinary) |
| R-6 | Update RFQ | Not Started | Modify RFQ details, status transitions |
| R-7 | RFQ Status Workflow | Not Started | Transition: PENDING_SELECTION → ACCEPTING_RESPONSE → AWARDED → COMPLETED |
| R-8 | RFQ Search/Filter | Not Started | Filter by status, company, date range |

### 3.4 RFQ Line Items

| ID | Feature | Status | Description |
|----|---------|--------|-------------|
| RL-1 | Create RFQ Line Item | Done | Link item to RFQ with quantity, specs |
| RL-2 | List All RFQ Items | Done | Get all with populated item, tech, commercial refs |
| RL-3 | Update RFQ Line Item | Not Started | Modify quantity, specs, pricing |
| RL-4 | Delete RFQ Line Item | Not Started | Soft delete line item from RFQ |
| RL-5 | Bulk Create Line Items | Not Started | Add multiple items to an RFQ at once |

---

## 4. API Endpoints

### 4.1 Authentication (`/api/v1/user`)

```
POST   /register            Public    Create user account
POST   /login               Public    Authenticate, return tokens
POST   /refresh-token        Public    Refresh access token
POST   /logout               Auth      Invalidate session
GET    /profile              Auth      Get current user
PATCH  /profile              Auth      Update current user
PATCH  /change-password      Auth      Change password
GET    /admin/users          Auth+Role List users (ADMIN, TECH_ADMIN)
```

### 4.2 Items (`/api/v1/item`)

```
POST   /                     Auth      Create item
GET    /                     Auth      Get item by ?itemCode=
GET    /all                  Auth      List all active items
PUT    /                     Auth      Update item by ?itemCode=
DELETE /                     Auth      Soft delete item
PATCH  /restore              Auth      Restore soft-deleted item
DELETE /permanent            Auth      Hard delete (if unreferenced)
```

### 4.3 RFQs (`/api/v1/rfq`)

```
POST   /                     Auth      Create RFQ
GET    /all                  Auth      List all RFQs
GET    /:rfqId               Auth      Get single RFQ
POST   /uploadFile           Auth      Upload document
DELETE /:rfqId               Auth      Soft delete RFQ
```

### 4.4 RFQ Items (`/api/v1/rfqItem`)

```
POST   /                     Auth      Create RFQ line item with specs
GET    /all                  Auth      List all RFQ items (populated)
```

---

## 5. Non-Functional Requirements

### 5.1 Security

- JWT-based stateless authentication (access token: 1hr, refresh token: 7d)
- Passwords hashed with bcrypt (auto-hashed in Mongoose pre-save hook)
- Role-based access control (RBAC) with middleware-level enforcement
- Input sanitization on all user inputs (strip HTML/angle brackets)
- HTTP-only cookies for token storage
- CORS restricted to known origins

### 5.2 Data Integrity

- Unique constraints on: `itemCode`, `prNumber`, `userName`, `email`
- Soft delete pattern preserves referential integrity
- Hard delete blocked if item is referenced in any RFQ line item
- Mongoose schema-level validation (required fields, enums, min/max)
- Conditional validation: `quotedOn` required only when `isQuoted = true`

### 5.3 Performance

- Database indexes on: `itemCode`, `prNumber`, `isDeleted`, `userName`
- Mongoose `populate()` for resolving references (avoid N+1 queries)

### 5.4 Scalability

- Stateless API — horizontally scalable behind a load balancer
- MongoDB Atlas (cloud-hosted, auto-scaling capable)
- Cloudinary for file storage (offloads binary data from DB)

---

## 6. Planned Features (Roadmap)

### Phase 1 — Core Completion (Current)

- [ ] Complete RFQ update endpoint (R-6)
- [ ] Implement RFQ status workflow transitions (R-7)
- [ ] RFQ line item update and delete (RL-3, RL-4)
- [ ] Full admin user listing implementation (U-8)
- [ ] Add pagination to all list endpoints

### Phase 2 — Search & Filtering

- [ ] RFQ search by status, company, date range (R-8)
- [ ] Item search by name, type, code pattern
- [ ] RFQ line item filtering by item code, quantity range
- [ ] Sorting on all list endpoints

### Phase 3 — AI-Powered Extraction

- [ ] PDF/document parsing for incoming RFQs
- [ ] AI extraction of item codes, quantities, pricing from vendor documents
- [ ] Confidence scoring for extracted data
- [ ] Auto-matching extracted items to Item Master
- [ ] Review/approval workflow for AI-extracted data

### Phase 4 — Analytics & Reporting

- [ ] Historical pricing trends per item across RFQs
- [ ] Vendor comparison reports
- [ ] RFQ turnaround time analytics
- [ ] Item usage frequency tracking

### Phase 5 — Advanced Features

- [ ] Email integration for receiving RFQs
- [ ] Notification system (RFQ status changes, due date reminders)
- [ ] Audit logging (who changed what, when)
- [ ] Bulk import/export (CSV, Excel)
- [ ] API rate limiting
- [ ] Comprehensive test suite (unit + integration)

---

## 7. Technical Debt & Known Issues

| Issue | Priority | Notes |
|-------|----------|-------|
| No test suite | High | No unit or integration tests exist |
| No request validation library | Medium | Using hand-rolled validators; consider Zod or Joi |
| No API documentation | Medium | No Swagger/OpenAPI spec |
| No logging framework | Medium | Using console.log; should adopt Winston or Pino |
| Admin users endpoint incomplete | Low | Route exists but needs full implementation |
| No pagination on list endpoints | Medium | All list endpoints return full result sets |
| No rate limiting | Low | API is unprotected against abuse |
| CORS origins hardcoded | Low | Should come from env config |
| No health check DB validation | Low | `/health` doesn't verify DB connection |

---

## 8. Environment & Deployment

### Required Environment Variables

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (default: 8080) |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `JWT_SECRET_KEY` | General JWT signing key |
| `ACCESS_TOKEN_SECRET` | Access token signing key |
| `ACCESS_TOKEN_EXPIRY` | Access token TTL in seconds (3600) |
| `REFRESH_TOKEN_SECRET` | Refresh token signing key |
| `REFRESH_TOKEN_EXPIRY` | Refresh token TTL in seconds (604800) |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary account name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |

### Deployment Notes

- Build: `npm run build` produces `dist/` with compiled JS + source maps
- Start: `npm start` runs the compiled output
- Database: MongoDB Atlas (cloud) — no local DB setup needed
- File storage: Cloudinary (cloud) — no local file persistence needed
