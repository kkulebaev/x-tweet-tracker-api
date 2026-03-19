import { Bot, InlineKeyboard } from 'grammy';
import { mustEnv } from './env.js';
import { prisma } from './prisma.js';

function isMessageNotModifiedError(e: unknown) {
  const msg = String((e as any)?.description ?? (e as any)?.message ?? '').toLowerCase();
  return msg.includes('message is not modified');
}

function mustAdmin(ctxFromId: number | undefined) {
  const adminId = Number(mustEnv('TELEGRAM_ADMIN_USER_ID'));
  if (!ctxFromId || Number(ctxFromId) !== adminId) {
    const err = new Error('forbidden');
    (err as any).code = 'FORBIDDEN';
    throw err;
  }
}

function normalizeUsername(s: string) {
  return s.trim().replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
}

function parseUsernamesFromText(text: string) {
  return text
    .split(/[\s,]+/g)
    .map(normalizeUsername)
    .filter(Boolean);
}

async function renderAccountsMessage() {
  const accounts = await prisma.account.findMany({ orderBy: { createdAt: 'asc' } });

  const header = '🚀 <b>Voyager</b> — трекер X\n';
  if (accounts.length === 0) {
    return {
      text: header + '\nСписок пуст. Добавь аккаунт командой:\n<code>/add boshen_c</code>',
      keyboard: new InlineKeyboard().text('➕ Добавить', 'ui:add').row().text('▶️ Запустить сбор', 'ui:run'),
    };
  }

  const lines = accounts.map((a, idx) => {
    const st = a.enabled ? '✅' : '⛔';
    return `${idx + 1}. ${st} <b>@${a.xUsername}</b>`;
  });

  // One row per account: toggle + delete
  const kb = new InlineKeyboard();
  accounts.forEach((a, idx) => {
    const n = idx + 1;
    kb.text(`${n} ${a.enabled ? '⛔ Выкл' : '✅ Вкл'}`, `acc:toggle:${a.id}`)
      .text(`${n} 🗑`, `acc:delask:${a.id}`)
      .row();
  });

  kb.text('🔄 Обновить', 'ui:list').text('▶️ Запустить сбор', 'ui:run').row();
  kb.text('➕ Добавить', 'ui:add');

  return {
    text: header + '\n' + lines.join('\n'),
    keyboard: kb,
  };
}

export function createTelegramBot() {
  const token = mustEnv('TELEGRAM_BOT_TOKEN');
  const bot = new Bot(token);

  bot.catch((err) => {
    console.error('telegram bot error', err);
  });

  bot.command('start', async (ctx) => {
    mustAdmin(ctx.from?.id);
    const { text, keyboard } = await renderAccountsMessage();
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  });

  bot.command('help', async (ctx) => {
    mustAdmin(ctx.from?.id);
    await ctx.reply(
      '🛰️ <b>Voyager</b> — админка\n\n' +
        'Команды:\n' +
        '<code>/list</code> — список аккаунтов\n' +
        '<code>/add boshen_c elonmusk</code> — добавить (можно несколько)\n' +
        '<code>/run</code> — запустить сбор вручную',
      { parse_mode: 'HTML' },
    );
  });

  bot.command('list', async (ctx) => {
    mustAdmin(ctx.from?.id);
    const { text, keyboard } = await renderAccountsMessage();
    await ctx.reply(text, { parse_mode: 'HTML', reply_markup: keyboard });
  });

  bot.command('add', async (ctx) => {
    mustAdmin(ctx.from?.id);
    const text = String(ctx.match ?? '').trim();
    const names = parseUsernamesFromText(text);
    if (names.length === 0) {
      await ctx.reply('Формат: <code>/add boshen_c elonmusk</code>', { parse_mode: 'HTML' });
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

    const { text: listText, keyboard } = await renderAccountsMessage();
    await ctx.reply(`✅ Добавил/включил: ${created.map((x) => '@' + x).join(', ')}`, { parse_mode: 'HTML' });
    await ctx.reply(listText, { parse_mode: 'HTML', reply_markup: keyboard });
  });

  bot.command('run', async (ctx) => {
    mustAdmin(ctx.from?.id);
    await ctx.reply('⏳ Запускаю сбор…');
    const { runWorkerOnce } = await import('./worker.js');
    const r = await runWorkerOnce();

    const errLines = r.errors.slice(0, 5).map((e) => `- @${e.xUsername}: ${e.error}`).join('\n');
    const errBlock = r.errors.length ? `\n\nОшибки (первые 5):\n${errLines}` : '';

    await ctx.reply(
      `✅ Готово\n` +
        `Аккаунтов: ${r.accountsProcessed}/${r.accountsTotal}\n` +
        `Сохранено твитов: ${r.tweetsInserted}\n` +
        `Ошибок: ${r.errors.length}` +
        errBlock,
    );
  });

  bot.on('callback_query:data', async (ctx) => {
    mustAdmin(ctx.from?.id);
    const data = String(ctx.callbackQuery.data);
    await ctx.answerCallbackQuery();

    // Simple UI actions
    if (data === 'ui:list') {
      const { text, keyboard } = await renderAccountsMessage();
      if (ctx.callbackQuery.message) {
        try {
          await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
        } catch (e) {
          if (!isMessageNotModifiedError(e)) throw e;
        }
      }
      return;
    }

    if (data === 'ui:run') {
      const { runWorkerOnce } = await import('./worker.js');
      const r = await runWorkerOnce();
      const msg = `✅ Готово: аккаунтов ${r.accountsProcessed}/${r.accountsTotal}, твитов ${r.tweetsInserted}, ошибок ${r.errors.length}`;
      if (ctx.callbackQuery.message) {
        try {
          await ctx.editMessageText(msg);
        } catch (e) {
          if (!isMessageNotModifiedError(e)) throw e;
        }
      }
      return;
    }

    if (data === 'ui:add') {
      await ctx.reply('Пришли командой: <code>/add boshen_c elonmusk</code>', { parse_mode: 'HTML' });
      return;
    }

    // Per-account actions
    if (data.startsWith('acc:toggle:')) {
      const id = data.split(':')[2];
      const acc = await prisma.account.findUnique({ where: { id } });
      if (!acc) return;
      await prisma.account.update({ where: { id }, data: { enabled: !acc.enabled } });

      const { text, keyboard } = await renderAccountsMessage();
      if (ctx.callbackQuery.message) {
        try {
          await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
        } catch (e) {
          if (!isMessageNotModifiedError(e)) throw e;
        }
      }
      return;
    }

    if (data.startsWith('acc:delask:')) {
      const id = data.split(':')[2];
      const acc = await prisma.account.findUnique({ where: { id } });
      if (!acc || !ctx.callbackQuery.message) return;

      const kb = new InlineKeyboard()
        .text('🗑 Удалить', `acc:delyes:${id}`)
        .text('❌ Отмена', 'ui:list');

      try {
        await ctx.editMessageText(`Удалить <b>@${acc.xUsername}</b>?`, { parse_mode: 'HTML', reply_markup: kb });
      } catch (e) {
        if (!isMessageNotModifiedError(e)) throw e;
      }
      return;
    }

    if (data.startsWith('acc:delyes:')) {
      const id = data.split(':')[2];
      await prisma.account.delete({ where: { id } }).catch(() => {});

      const { text, keyboard } = await renderAccountsMessage();
      if (ctx.callbackQuery.message) {
        try {
          await ctx.editMessageText(text, { parse_mode: 'HTML', reply_markup: keyboard });
        } catch (e) {
          if (!isMessageNotModifiedError(e)) throw e;
        }
      }
      return;
    }
  });

  return bot;
}
