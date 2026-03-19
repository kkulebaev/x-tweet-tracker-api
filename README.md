<p align="center">
  <strong>Voyager</strong> · X Tweet Tracker
</p>

<p align="center">
  Track new posts from a curated list of X accounts on a schedule.
</p>

<p align="center">
  <img alt="runtime" src="https://img.shields.io/badge/runtime-Node.js-339933" />
  <img alt="db" src="https://img.shields.io/badge/db-PostgreSQL-336791" />
  <img alt="orm" src="https://img.shields.io/badge/ORM-Prisma-2D3748" />
  <img alt="deploy" src="https://img.shields.io/badge/deploy-Railway-6B46C1" />
</p>

# x-tweet-tracker

**Voyager** is a small service that periodically fetches recent public posts from a configured list of X accounts and stores them in Postgres.

## What it does
- Stores accounts in `accounts` (`x_username`, `enabled`, `since_id`)
- Fetches **up to 5 latest posts** per account per run via **X API** (Bearer token)
- Saves posts to `tweets` (deduplicated by `tweet_id`)
- Provides a minimal **admin API** and a **Telegram admin bot UI**

## Tech
- Node.js + TypeScript
- Express (admin API + Telegram webhook)
- Prisma + PostgreSQL
- Railway (Web service) + Railway Cron (worker)

## Data model (high level)
- `accounts`
  - `x_username` — X username
  - `x_user_id` — resolved via API (cached)
  - `since_id` — last seen tweet id (for incremental fetching)
  - `enabled`
- `tweets`
  - `tweet_id` (PK)
  - `account_id` (FK)
  - `created_at`, `text`, `url`, `raw`

## Environment variables

### Required (both Web + Cron)
- `DATABASE_URL` — Railway Postgres connection string
- `X_BEARER_TOKEN` — X API Bearer token

### Web service (admin API)
- `ADMIN_TOKEN` — used as `Authorization: Bearer <ADMIN_TOKEN>` for `/admin/*`

### Telegram admin bot (recommended UX)
- `TELEGRAM_BOT_TOKEN` — token from BotFather
- `TELEGRAM_ADMIN_USER_ID` — your Telegram numeric user id (only this user can access)

> Railway usually sets `PORT` automatically.

## Telegram admin bot

Webhook endpoint:
- `POST /telegram/webhook`

Commands (recommended to set in BotFather):
- `/start` — открыть админку
- `/help` — помощь
- `/list` — список аккаунтов
- `/add` — добавить аккаунт (юзернейм или ссылка на профиль)
- `/run` — запустить сбор вручную

UX notes:
- Список аккаунтов — кнопки-номера (grid 4×N), открывают карточку аккаунта.
- В карточке: включить/выключить, удалить (с подтверждением).

## Admin API
All endpoints require:
- `Authorization: Bearer <ADMIN_TOKEN>`

Endpoints:
- `GET /admin/accounts`
- `POST /admin/accounts` body: `{ "x_username": "kkulebaev" }`
- `PATCH /admin/accounts/:id` body: `{ "enabled": false }`
- `DELETE /admin/accounts/:id`
- `POST /admin/run`
- `GET /admin/tweets?x_username=kkulebaev&limit=50`

## Local development

```bash
npm ci
npx prisma generate

# create/apply local migration (for local DB)
# for Railway/production use migrate deploy
npx prisma migrate dev

npm run dev
```

## Railway deployment

### Web service
Build command:
```bash
npm ci && npm run build && npx prisma generate
```

Start command:
```bash
npm run prisma:migrate && npm start
```

### Cron job
Command:
```bash
npm run prisma:migrate && npm run cron
```

Schedule:
- `0 * * * *` (hourly)

## Notes
- This project is designed to be small and cheap to run. Keep API usage low.
- Telegram link previews are disabled in messages to keep UI clean.
