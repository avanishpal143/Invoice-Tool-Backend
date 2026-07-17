# Devlofox CRM — Backend API

Node.js + Express + Prisma + MySQL REST API.

## Prerequisites
- Node.js 18+
- MySQL 8.0+

## Setup

```bash
cd backend
npm install --cache /tmp/npm-cache

# Copy env and configure your DB credentials
cp .env.development .env
# Edit DATABASE_URL in .env

# Create DB and run migrations
mysql -u root -e "CREATE DATABASE IF NOT EXISTS devlofox_crm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
npx prisma migrate dev --name init

# Seed demo data
npx ts-node prisma/seed.ts

# Start dev server
npm run dev
```

## Demo Credentials
| Role | Email | Password |
|------|-------|----------|
| Admin | admin@devlofox.com | Admin@123 |
| Manager | manager1@devlofox.com | Manager@123 |
| Sales | sales1@devlofox.com | Sales@123 |

## Scripts
| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with hot reload (port 4000) |
| `npm run build` | Compile TypeScript to dist/ |
| `npm run start` | Run compiled production build |
| `npm run db:migrate` | Run pending Prisma migrations |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Open Prisma Studio |

## API Base URL
`http://localhost:4000/api/v1`

## Architecture
```
src/
  config/         # env validation (Zod), Winston logger
  lib/            # Prisma singleton, invoice counter, mailer
  middleware/     # authenticate, requireRole, validate, auditLogger, rateLimiter
  modules/        # Feature modules (auth, users, leads, clients, invoices, ledger, ...)
  pdf/            # Invoice HTML template + Puppeteer renderer
```
# Invoice-Tool-Backend
