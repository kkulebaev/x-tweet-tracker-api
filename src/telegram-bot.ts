import { Bot, InlineKeyboard } from 'grammy';
import { mustEnv } from './env.js';
import { prisma } from './prisma.js';

function mustAdmin(ctxFromId: number | undefined) {
  const adminId = Number(mustEnv('TELEGRAM_ADMIN_USER_ID'));
  if (!ctxFromId || Number(ctxFromId) !== adminId) {
    const err = new Error('forbidden');
    (err as any).code = 'FORBIDDEN';
    throw err;
  }
}

function parseUsernamesFromText(text: string) {
  return text
    .split(/[\s,]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.replace(/^@/, ''));
}

export function createTelegramBot() {
  const token = mustEnv('TELEGRAM_BOT_TOKEN');
  const bot = new Bot(token);

  bot.catch((err) => {
    console.error('telegram bot error', err);
  });

  bot.command('start', async (ctx) => {
    mustAdmin(ctx.from?.id);
    await ctx.reply('x-tweet-tracker admin bot\n\nCommands:\n/list — list accounts\n/add <usernames> — add accounts\n/run — run worker now');
  });

  bot.command('list', async (ctx) => {
    mustAdmin(ctx.from?.id);

    const accounts = await prisma.account.findMany({ orderBy: { createdAt: 'asc' } });

    if (accounts.length === 0) {
      await ctx.reply('No accounts yet. Use /add boshen_c');
      return;
    }

    const lines = accounts.map((a) => {
      const st = a.enabled ? '✅' : '⛔';
      const sid = a.sinceId ? ` since:${a.sinceId}` : '';
      return `${st} @${a.xUsername}${sid}`;
    });

    const kb = new InlineKeyboard();
    kb.text('🔄 Refresh', 'a:list');
    kb.text('▶️ Run now', 'a:run');

    await ctx.reply(lines.join('\n'), { reply_markup: kb });
  });

  bot.command('add', async (ctx) => {
    mustAdmin(ctx.from?.id);
    const text = String(ctx.match ?? '').trim();
    const names = parseUsernamesFromText(text);
    if (names.length === 0) {
      await ctx.reply('Usage: /add boshen_c elonmusk');
      return;
    }

    const created: string[] = [];
    for (const xUsername of names) {
      const a = await prisma.account.upsert({
        where: { xUsername },
        create: { xUsername },
        update: { enabled: true },
      });
      created.push(a.xUsername);
    }

    await ctx.reply(`Added/enabled: ${created.map((x) => '@' + x).join(', ')}`);
  });

  bot.command('run', async (ctx) => {
    mustAdmin(ctx.from?.id);
    await ctx.reply('Running…');
    const { runWorkerOnce } = await import('./worker.js');
    const r = await runWorkerOnce();
    await ctx.reply(`Done. accounts: ${r.accountsProcessed}/${r.accountsTotal}, tweets inserted: ${r.tweetsInserted}, errors: ${r.errors.length}`);
  });

  bot.on('callback_query:data', async (ctx) => {
    mustAdmin(ctx.from?.id);
    const data = String(ctx.callbackQuery.data);
    await ctx.answerCallbackQuery();

    if (data === 'a:list') {
      // Reuse /list rendering
      const accounts = await prisma.account.findMany({ orderBy: { createdAt: 'asc' } });
      const lines = accounts.length
        ? accounts.map((a) => `${a.enabled ? '✅' : '⛔'} @${a.xUsername}${a.sinceId ? ` since:${a.sinceId}` : ''}`).join('\n')
        : 'No accounts yet. Use /add boshen_c';

      const kb = new InlineKeyboard();
      kb.text('🔄 Refresh', 'a:list');
      kb.text('▶️ Run now', 'a:run');

      if (ctx.callbackQuery.message) {
        await ctx.editMessageText(lines, { reply_markup: kb });
      }
      return;
    }

    if (data === 'a:run') {
      const { runWorkerOnce } = await import('./worker.js');
      const r = await runWorkerOnce();
      const msg = `Done. accounts: ${r.accountsProcessed}/${r.accountsTotal}, tweets inserted: ${r.tweetsInserted}, errors: ${r.errors.length}`;
      if (ctx.callbackQuery.message) {
        await ctx.editMessageText(msg);
      }
      return;
    }
  });

  return bot;
}
