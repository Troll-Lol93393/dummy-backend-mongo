# CLAUDE.md - Sheth Backend (RFQ Management System)

## Project Overview

Express.js + TypeScript backend API for an AI-Powered RFQ (Request for Quotation) data extraction system. Uses MongoDB Atlas via Mongoose ODM. The system manages Item Masters, RFQs, and RFQ Line Items for vendor quotation workflows.

## Tech Stack

- **Runtime:** Node.js with TypeScript (strict mode)
- **Framework:** Express.js 4.x
- **Database:** MongoDB Atlas + Mongoose 8.x
- **Auth:** JWT (access + refresh tokens) with bcrypt password hashing
- **File Storage:** Cloudinary (uploads via Multer)
- **Formatting:** Prettier

## Commands

```bash
npm run dev              # Start dev server (nodemon, port 8080)
npm run build            # Compile TypeScript → dist/
npm run build:watch      # Watch mode compilation
npm start                # Run compiled JS from dist/
npm run format           # Format all src files with Prettier
npm run format:check     # Check formatting without writing
npm run clean            # Remove dist/
```

## Project Structure

```
src/
├── index.ts              # Entry point (starts server, connects DB)
├── app.ts                # Express app setup, middleware, error handler
├── constants.ts          # App-wide constants (DB name, enums)
├── config/dbConnect.ts   # MongoDB Atlas connection
├── controller/           # Route handlers (business logic)
├── routes/               # Express route definitions
├── models/               # Mongoose schemas and models
├── middlewares/           # Auth (JWT/RBAC), file upload (Multer)
├── utils/                # ApiError, ApiResponse, asyncHandler, validation, cloudinary
└── types/express/        # Custom Express Request type extensions
```

## Architecture & Patterns

- **MVC:** Models → Controllers → Routes (no service layer currently)
- **Async Error Handling:** All controllers wrapped with `asyncHandler()` — never use raw try/catch in route handlers
- **Standard Responses:** Always use `ApiResponse<T>` for success, `ApiError` for errors
- **Soft Delete:** Items and RFQs use `isDeleted` + `deletedAt` flags — never hard-delete unless explicitly required and item is unreferenced
- **JWT Auth Flow:** Access token (1hr) + Refresh token (7d), stored in HTTP-only cookies

## Coding Standards

### TypeScript

- **Strict mode is ON** — all strict flags enabled in tsconfig
- `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess` are enforced
- Always define return types on exported functions
- Use interfaces for request bodies, response shapes, and model documents
- Extend Express `Request` type via `src/types/express/index.d.ts` for custom properties (e.g., `req.user`)

### Naming Conventions

| Element           | Convention     | Example                    |
|-------------------|----------------|----------------------------|
| Variables/funcs   | camelCase      | `getUserProfile`           |
| Classes/Interfaces| PascalCase     | `ApiResponse`, `IUser`     |
| Constants/Enums   | UPPER_SNAKE    | `ROLE_ADMIN`, `DB_NAME`    |
| Files (general)   | camelCase      | `asyncHandler.ts`          |
| Files (models)    | dot-separated  | `item.model.ts`            |
| Files (routes)    | dot-separated  | `user.routes.ts`           |
| Files (controllers)| dot-separated | `rfq.controller.ts`        |

### Formatting (Prettier)

- 4-space indentation (no tabs)
- Semicolons required
- Double quotes for strings
- Trailing commas: ES5 style
- Print width: 100 characters
- Arrow parens: avoid when possible (`x => x` not `(x) => x`)
- Line endings: LF

### API Design

- Base path: `/api/v1/`
- RESTful resource naming: `/api/v1/rfq`, `/api/v1/item`, `/api/v1/rfqItem`
- Always return `ApiResponse` shape: `{ statusCode, data, message, success }`
- Error shape: `{ success: false, message, errors[] }`
- Use proper HTTP status codes: 200 (OK), 201 (Created), 400 (Bad Request), 401 (Unauthorized), 403 (Forbidden), 404 (Not Found), 409 (Conflict), 500 (Internal Server Error)
- Validate inputs using `src/utils/validation.ts` helpers before processing
- Sanitize all user inputs with `sanitizeInput()` to prevent injection

### Mongoose / MongoDB

- Always enable `timestamps: true` on schemas
- Use indexed fields for frequently queried columns (`itemCode`, `prNumber`, `isDeleted`)
- Use `ref` with `ObjectId` for relationships — populate in queries as needed
- Schema validation at the Mongoose level (required, enum, min/max)
- Prefer `findOne` + manual checks over `findOneAndUpdate` when you need to validate before mutation

### Authentication & Authorization

- JWT middleware: `verifyJWT` — extracts token from `Authorization: Bearer` header or cookies
- Role middleware: `verifyRoles(...allowedRoles)` — chain after `verifyJWT`
- Roles: `ROLE_OWNER`, `ROLE_ADMIN`, `ROLE_OFFICE_STAFF`, `ROLE_FIELD_STAFF`
- Passwords hashed with bcrypt (auto-hashed in pre-save hook)
- Never return password or refreshToken fields in API responses

### Error Handling

- Throw `ApiError` instances — the global error handler in `app.ts` catches them
- Use `asyncHandler()` wrapper on all async route handlers
- Never swallow errors silently — always throw or log

### File Uploads

- Multer saves to `public/temp/` → then upload to Cloudinary → delete local file
- Use `upload.single("fieldName")` middleware on routes that accept files

## Environment Variables

Required in `.env`:
```
PORT, MONGODB_URI, JWT_SECRET_KEY,
ACCESS_TOKEN_SECRET, ACCESS_TOKEN_EXPIRY,
REFRESH_TOKEN_SECRET, REFRESH_TOKEN_EXPIRY,
CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
```

## Database Design (3-Entity Pattern)

Refer to `RFQ_Database_Design_Reference.pdf` for the canonical design:

1. **Item Master** (`items`) — permanent reference library of products. One entry per unique item code. Rarely changes.
2. **RFQ** (`rfqs`) — container for a single vendor quotation request. Has status lifecycle (PENDING_SELECTION → ACCEPTING_RESPONSE → AWARDED → COMPLETED).
3. **RFQ Line Items** (`rfqitems`) — per-RFQ snapshot linking to Item Master. Stores quantity, RFQ-specific commercial details, and technical overrides without modifying master data.

## CORS

Allowed origins: `hoppscotch.io`, `localhost:3000`. Update in `app.ts` when adding new frontends.
