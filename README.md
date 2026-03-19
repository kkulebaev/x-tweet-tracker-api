# x-tweet-tracker

Hourly tracker for new posts from a list of X accounts.

## What it does
- Stores a list of accounts (`x_username`) in Postgres
- Cron job fetches new posts via **X API** (Bearer token)
- Saves results to Postgres (`tweets`)

## Tech
- Node.js (TypeScript)
- Express (admin API)
- Prisma + Postgres
- Railway deploy (Web service + Cron job)

## Environment variables
- `DATABASE_URL` (Railway Postgres)
- `X_BEARER_TOKEN`
- `ADMIN_TOKEN` (for admin API)

Telegram admin bot:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_ADMIN_USER_ID`

## Local dev
```bash
npm ci
npx prisma migrate dev
npm run dev
```

Admin endpoints (Bearer auth):
- `GET /admin/accounts`
- `POST /admin/accounts` body: `{ "x_username": "elonmusk" }`
- `PATCH /admin/accounts/:id` body: `{ "enabled": false }`
- `DELETE /admin/accounts/:id`
- `POST /admin/run` (run worker now)
- `GET /admin/tweets?x_username=elonmusk&limit=50`

Telegram admin bot (recommended UX):
- Webhook: `POST /telegram/webhook`
- Commands:
  - `/list`
  - `/add <x_usernames>`
  - `/run`

## Railway
Create 2 services:

### Web service
- Build: `npm ci && npm run build && npx prisma generate`
- Start: `npm run prisma:migrate && npm start`

### Cron job
- Command: `npm run prisma:migrate && npm run cron`
- Schedule: `0 * * * *` (hourly)
