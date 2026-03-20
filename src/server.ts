import 'dotenv/config';
import express from 'express';
import { mustEnv } from './env.js';
import { prisma } from './prisma.js';

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

const app = express();
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

  const patch: any = {};

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

app.post('/admin/sync', adminAuth(), async (_req, res) => {
  // Cron is responsible for fetching data from X API and then pushing results here.
  // This endpoint is kept to trigger a sync run in the cron service (not implemented here).
  res.status(501).json({ ok: false, error: 'Not implemented: use cron service to sync' });
});

app.post('/admin/tweets/push', adminAuth(), async (req, res) => {
  const accountId = String(req.body?.accountId ?? '').trim();
  const newestId = req.body?.newestId ? String(req.body.newestId).trim() : null;
  const tweets = Array.isArray(req.body?.tweets) ? req.body.tweets : null;

  if (!accountId) return res.status(400).json({ ok: false, error: 'accountId is required' });
  if (!tweets) return res.status(400).json({ ok: false, error: 'tweets[] is required' });

  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) return res.status(404).json({ ok: false, error: 'Account not found' });

  let inserted = 0;

  // Insert oldest -> newest for stable results
  const sorted = [...tweets].sort((a, b) => String(a.id).localeCompare(String(b.id)));

  for (const t of sorted) {
    const id = t?.id ? String(t.id).trim() : '';
    const text = typeof t?.text === 'string' ? t.text : '';
    const url = typeof t?.url === 'string' ? t.url : '';
    const createdAtRaw = t?.created_at ?? t?.createdAt;
    const createdAt = createdAtRaw ? new Date(String(createdAtRaw)) : new Date();

    if (!id) continue;

    await prisma.tweet.upsert({
      where: { tweetId: id },
      create: {
        tweetId: id,
        accountId: accountId,
        createdAt,
        text,
        url,
        raw: t?.raw ?? t,
      },
      update: {
        text,
        url,
        raw: t?.raw ?? t,
      },
    });
    inserted += 1;
  }

  if (newestId) {
    await prisma.account.update({ where: { id: accountId }, data: { sinceId: newestId } });
  }

  res.json({ ok: true, inserted, accountId, newestId });
});

app.get('/admin/tweets', adminAuth(), async (req, res) => {
  const xUsername = String(req.query.x_username ?? '').trim().replace(/^@/, '');
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);

  const whereAccount = xUsername ? { account: { xUsername } } : {};

  const tweets = await prisma.tweet.findMany({
    where: whereAccount as any,
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { account: true },
  });

  res.json({ ok: true, tweets });
});

const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`x-tweet-tracker-api listening on 0.0.0.0:${PORT}`);
});
