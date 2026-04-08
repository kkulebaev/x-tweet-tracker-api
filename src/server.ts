import 'dotenv/config';
import express from 'express';
import { mustEnv } from './env.js';
import { prisma } from './prisma.js';
import { publishTweetsToStream, type RedisTweetEvent, type RedisTweetMediaEvent } from './redis.js';
import { allowCorsAll } from './cors.js';

type PushTweetDTO = {
  id?: unknown;
  text?: unknown;
  url?: unknown;
  created_at?: unknown;
  createdAt?: unknown;
  mediaUrls?: unknown;
  raw?: unknown;
};

type ClaimedTweetRow = {
  tweet_id: string;
};

type SerializedTweetMedia = {
  url: string;
  type: string;
  position: number;
};

function adminAuth() {
  const expected = mustEnv('ADMIN_TOKEN');
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const hdr = String(req.headers.authorization ?? '');
    const token = hdr.startsWith('Bearer ') ? hdr.slice('Bearer '.length).trim() : '';
    if (!token || token !== expected) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }
    next();
  };
}

function isPushTweetArray(value: unknown): value is PushTweetDTO[] {
  return Array.isArray(value);
}

function normalizeMediaUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const urls: string[] = [];

  for (const item of value) {
    if (typeof item !== 'string') continue;
    const url = item.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }

  return urls;
}

function toMediaCreateMany(mediaUrls: string[]) {
  return mediaUrls.map((url, index) => ({
    url,
    type: 'photo',
    position: index,
  }));
}

function serializeMedia(media: Array<{ url: string; type: string; position: number }>): SerializedTweetMedia[] {
  return media
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      url: item.url,
      type: item.type,
      position: item.position,
    }));
}

function toRedisMedia(media: SerializedTweetMedia[]): RedisTweetMediaEvent[] {
  return media.map((item) => ({
    url: item.url,
    type: item.type,
    position: item.position,
  }));
}

const app = express();

// Allow browser-based admin UI to call this API cross-origin.
app.use(allowCorsAll());

// Request logging (method, path, status, duration). No headers/body logged.
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const path = req.originalUrl || req.url;
    console.log(`${req.method} ${path} -> ${res.statusCode} (${ms}ms)`);
  });
  next();
});

app.use(express.json());

app.get('/healthz', (_req, res) => res.status(200).send('ok'));

app.get('/admin/accounts', adminAuth(), async (_req, res) => {
  const accounts = await prisma.account.findMany({ orderBy: { createdAt: 'asc' } });
  res.json({ ok: true, accounts });
});

app.get('/admin/accounts/:id', adminAuth(), async (req, res) => {
  const id = String(req.params.id);
  const account = await prisma.account.findUnique({ where: { id } });
  if (!account) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, account });
});

app.post('/admin/accounts', adminAuth(), async (req, res) => {
  const xUsername = String(req.body?.x_username ?? req.body?.xUsername ?? '').trim().replace(/^@/, '');
  if (!xUsername) return res.status(400).json({ ok: false, error: 'x_username is required' });

  const account = await prisma.account.upsert({
    where: { xUsername },
    create: { xUsername },
    update: { enabled: true },
  });

  res.json({ ok: true, account });
});

app.patch('/admin/accounts/:id', adminAuth(), async (req, res) => {
  const id = String(req.params.id);

  const patch: Record<string, boolean | string> = {};

  if (typeof req.body?.enabled === 'boolean') patch.enabled = req.body.enabled;

  const xUserId = req.body?.x_user_id ?? req.body?.xUserId;
  if (typeof xUserId === 'string' && xUserId.trim()) patch.xUserId = xUserId.trim();

  const sinceId = req.body?.since_id ?? req.body?.sinceId;
  if (typeof sinceId === 'string' && sinceId.trim()) patch.sinceId = sinceId.trim();

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ ok: false, error: 'No valid fields to patch (enabled|x_user_id|since_id)' });
  }

  const account = await prisma.account.update({ where: { id }, data: patch });
  res.json({ ok: true, account });
});

app.delete('/admin/accounts/:id', adminAuth(), async (req, res) => {
  const id = String(req.params.id);
  await prisma.account.delete({ where: { id } });
  res.json({ ok: true });
});

app.post('/admin/tweets/push', adminAuth(), async (req, res) => {
  const accountId = String(req.body?.accountId ?? '').trim();
  const newestId = req.body?.newestId ? String(req.body.newestId).trim() : null;
  const tweets = isPushTweetArray(req.body?.tweets) ? req.body.tweets : null;

  if (!accountId) return res.status(400).json({ ok: false, error: 'accountId is required' });
  if (!tweets) return res.status(400).json({ ok: false, error: 'tweets[] is required' });

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return res.status(404).json({ ok: false, error: 'Account not found' });

  let inserted = 0;
  const events: RedisTweetEvent[] = [];

  // Insert oldest -> newest for stable results
  const sorted = [...tweets].sort((a, b) => String(a.id).localeCompare(String(b.id)));

  for (const t of sorted) {
    const id = typeof t.id === 'string' ? t.id.trim() : '';
    const text = typeof t.text === 'string' ? t.text : '';
    const url = typeof t.url === 'string' ? t.url : '';
    const createdAtRaw = t.created_at ?? t.createdAt;
    const createdAt = createdAtRaw ? new Date(String(createdAtRaw)) : new Date();
    const mediaUrls = normalizeMediaUrls(t.mediaUrls);

    if (!id) continue;

    await prisma.$transaction(async (tx) => {
      await tx.tweet.upsert({
        where: { tweetId: id },
        create: {
          tweetId: id,
          accountId,
          createdAt,
          text,
          url,
          raw: t.raw ?? t,
        },
        update: {
          text,
          url,
          raw: t.raw ?? t,
        },
      });

      await tx.tweetMedia.deleteMany({ where: { tweetId: id } });

      if (mediaUrls.length > 0) {
        await tx.tweetMedia.createMany({
          data: toMediaCreateMany(mediaUrls).map((item) => ({
            tweetId: id,
            url: item.url,
            type: item.type,
            position: item.position,
          })),
        });
      }
    });

    const media = toRedisMedia(
      mediaUrls.map((mediaUrl, index) => ({
        url: mediaUrl,
        type: 'photo',
        position: index,
      })),
    );

    events.push({
      type: 'tweet.upserted',
      tweetId: id,
      accountId,
      xUsername: account.xUsername,
      createdAt: createdAt.toISOString(),
      text,
      url,
      media,
    });

    inserted += 1;
  }

  if (newestId) {
    await prisma.account.update({ where: { id: accountId }, data: { sinceId: newestId } });
  }

  // Best-effort publish to Redis stream (does not fail the request)
  try {
    await publishTweetsToStream(events);
  } catch (e) {
    console.warn('Redis publish failed', String((e as { message?: string })?.message ?? e));
  }

  res.json({ ok: true, inserted, accountId, newestId });
});

app.get('/admin/tweets', adminAuth(), async (req, res) => {
  const xUsername = String(req.query.x_username ?? '').trim().replace(/^@/, '');
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);

  const tweets = await prisma.tweet.findMany({
    where: xUsername ? { account: { xUsername } } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: {
      account: true,
      media: {
        orderBy: { position: 'asc' },
      },
    },
  });

  res.json({ ok: true, tweets: tweets.map((tweet) => ({ ...tweet, media: serializeMedia(tweet.media) })) });
});

// --- Telegram forwarder queue endpoints ---

// Atomically claim the next unsent tweet (oldest first).
// Returns { tweet, account } or { tweet: null }.
app.post('/admin/tweets/claim', adminAuth(), async (req, res) => {
  const limit = Math.min(Math.max(Number(req.body?.limit ?? 1), 1), 5);
  if (limit !== 1) {
    // Keep MVP simple and deterministic.
    return res.status(400).json({ ok: false, error: 'Only limit=1 is supported' });
  }

  const rows = await prisma.$queryRawUnsafe<ClaimedTweetRow[]>(
    `
    WITH cte AS (
      SELECT t.tweet_id
      FROM tweets t
      WHERE t.sent_to_telegram_at IS NULL
        AND t.claimed_at IS NULL
      ORDER BY t.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE tweets t
      SET claimed_at = now()
    FROM cte
    WHERE t.tweet_id = cte.tweet_id
    RETURNING t.tweet_id;
  `,
  );

  if (!rows.length) {
    return res.json({ ok: true, tweet: null });
  }

  const claimedTweetId = rows[0]?.tweet_id;
  if (!claimedTweetId) {
    return res.json({ ok: true, tweet: null });
  }

  const tweet = await prisma.tweet.findUnique({
    where: { tweetId: claimedTweetId },
    include: {
      account: true,
      media: {
        orderBy: { position: 'asc' },
      },
    },
  });

  if (!tweet) {
    return res.status(404).json({ ok: false, error: 'Claimed tweet not found' });
  }

  const { account: claimedAccount, media, ...tweetFields } = tweet;
  return res.json({
    ok: true,
    tweet: {
      ...tweetFields,
      media: serializeMedia(media),
    },
    account: claimedAccount,
  });
});

// Mark tweet as sent (idempotent)
app.post('/admin/tweets/:tweetId/mark-sent', adminAuth(), async (req, res) => {
  const tweetId = String(req.params.tweetId);
  const t = await prisma.tweet.findUnique({ where: { tweetId } });
  if (!t) return res.status(404).json({ ok: false, error: 'Tweet not found' });

  if (t.sentAt) {
    return res.json({ ok: true, alreadySent: true, tweetId });
  }

  await prisma.tweet.update({
    where: { tweetId },
    data: {
      sentAt: new Date(),
    },
  });

  return res.json({ ok: true, tweetId });
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`x-tweet-tracker-api listening on 0.0.0.0:${PORT}`);
});
