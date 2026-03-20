<p align="center">
  <img src="./assets/voyager-api-banner.svg" alt="Voyager API banner" />
</p>

<p align="center">
  <strong>Voyager API</strong> · storage + admin endpoints for x-tweet-tracker
</p>

<p align="center">
  <img alt="runtime" src="https://img.shields.io/badge/runtime-Node.js-339933" />
  <img alt="db" src="https://img.shields.io/badge/db-PostgreSQL-336791" />
  <img alt="orm" src="https://img.shields.io/badge/ORM-Prisma-2D3748" />
  <img alt="deploy" src="https://img.shields.io/badge/deploy-Railway-6B46C1" />
</p>

# x-tweet-tracker-api

This service is the **single source of truth** for persistence:
- stores accounts and tweets in Postgres
- exposes admin endpoints for bot/cron clients

X API calls are performed by **x-tweet-tracker-cron**. The cron pushes fetched tweets into this API.

## Services architecture
- **API** (this repo): DB + admin endpoints
- **Cron** (`x-tweet-tracker-cron`): reads accounts from API → fetches from X API → pushes tweets back
- **Bot** (`x-tweet-tracker-bot`): Telegram admin UI → talks to API only

## Endpoints (admin)
All endpoints require:
`Authorization: Bearer <ADMIN_TOKEN>`

Accounts:
- `GET /admin/accounts`
- `GET /admin/accounts/:id`
- `POST /admin/accounts` body: `{ "x_username": "kkulebaev" }`
- `PATCH /admin/accounts/:id` body (any of):
  - `{ "enabled": false }`
  - `{ "x_user_id": "<id>" }`
  - `{ "since_id": "<tweet_id>" }`
- `DELETE /admin/accounts/:id`

Tweets:
- `GET /admin/tweets?x_username=kkulebaev&limit=50`
- `POST /admin/tweets/push` (used by cron)

## Environment variables
- `DATABASE_URL` — Railway Postgres connection string
- `ADMIN_TOKEN` — bearer token for admin endpoints

> No `X_BEARER_TOKEN` here: X API calls live in the cron service.

## Local development

```bash
npm ci
npx prisma generate
npx prisma migrate dev
npm run dev
```

## Railway deployment
Build:
```bash
npm ci && npm run build && npx prisma generate
```

Start:
```bash
npm run prisma:migrate && npm start
```
