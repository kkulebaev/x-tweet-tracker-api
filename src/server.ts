import 'dotenv/config';
import express from 'express';
import { mustEnv } from './env.js';
import { prisma } from './prisma.js';
import { runWorkerOnce } from './worker.js';
import { createTelegramBot } from './telegram-bot.js';

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
  const enabled = req.body?.enabled;
  if (typeof enabled !== 'boolean') return res.status(400).json({ ok: false, error: 'enabled(boolean) is required' });

  const id = String(req.params.id);
  const account = await prisma.account.update({ where: { id }, data: { enabled } });
  res.json({ ok: true, account });
});

app.delete('/admin/accounts/:id', adminAuth(), async (req, res) => {
  const id = String(req.params.id);
  await prisma.account.delete({ where: { id } });
  res.json({ ok: true });
});

app.post('/admin/run', adminAuth(), async (_req, res) => {
  const r = await runWorkerOnce();
  res.json({ ok: true, result: r });
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
  console.log(`x-tweet-tracker listening on 0.0.0.0:${PORT}`);
});

// Telegram bot webhook endpoint
const bot = createTelegramBot();

// grammY requires bot.init() in webhook-only mode
bot.init().then(
  () => console.log('Telegram bot initialized'),
  (e) => console.error('Telegram bot init failed', e),
);

app.post('/telegram/webhook', async (req, res) => {
  try {
    await bot.handleUpdate(req.body);
    res.sendStatus(200);
  } catch (e) {
    console.error('telegram webhook error', e);
    res.sendStatus(500);
  }
});
