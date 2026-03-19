import { Bot, InlineKeyboard } from 'grammy';

const HTML_NO_PREVIEW = {
  parse_mode: 'HTML' as const,
  link_preview_options: { is_disabled: true },
};
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
  const raw = s.trim();
  if (!raw) return '';

  // Allow pasting profile links like:
  // https://x.com/webstandards_ru?s=21&t=...
  // https://twitter.com/webstandards_ru
  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      const host = u.hostname.replace(/^www\./, '').toLowerCase();
      if (host === 'x.com' || host === 'twitter.com') {
        const parts = u.pathname.split('/').filter(Boolean);
        const first = parts[0] ?? '';
        // ignore non-profile paths
        if (first && !['home', 'i', 'intent', 'search', 'hashtag', 'share'].includes(first.toLowerCase())) {
          return first.replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
        }
      }
    }
  } catch {
    // ignore
  }

  return raw.replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
}

function extractFirstUsername(text: string) {
  const parts = text.split(/[\s,]+/g).map(normalizeUsername).filter(Boolean);
  return parts[0] ?? null;
}

export function createTelegramBot() {
  const token = mustEnv('TELEGRAM_BOT_TOKEN');
  const bot = new Bot(token);

  // Simple per-admin state (single user, server memory). Good enough for MVP.
  const state = {
    awaitingAddUsernames: false,
  };

  bot.catch((err) => {
    console.error('telegram bot error', err);
  });

  async function renderAccountsMessage() {
    const accounts = await prisma.account.findMany({ orderBy: { createdAt: 'asc' } });

    const header = '🚀 <b>Voyager</b> — трекер X\n';
    if (accounts.length === 0) {
      return {
        text: header + '\nСписок пуст. Добавь аккаунт командой:\n<code>/add kkulebaev</code>',
        keyboard: new InlineKeyboard().text('➕ Добавить', 'ui:add').row().text('▶️ Запустить сбор', 'ui:run'),
      };
    }

    const lines = accounts.map((a, idx) => {
      const st = a.enabled ? '✅' : '⛔';
      const url = `https://x.com/${a.xUsername}`;
      return `${idx + 1}. ${st} <a href="${url}">@${a.xUsername}</a>`;
    });

    // Grid 4×N: open account card by number
    const kb = new InlineKeyboard();
    accounts.forEach((a, idx) => {
      const n = idx + 1;
      kb.text(String(n), `acc:open:${a.id}`);
      if (n % 4 === 0) kb.row();
    });
    kb.row();

    kb.text('🔄 Обновить', 'ui:list').text('▶️ Запустить сбор', 'ui:run').row();
    kb.text('➕ Добавить', 'ui:add');

    return {
      text: header + '\n' + lines.join('\n') + '\n\nНажми на номер ниже, чтобы открыть карточку аккаунта.',
      keyboard: kb,
    };
  }

  async function renderAccountCard(id: string) {
    const acc = await prisma.account.findUnique({ where: { id } });
    if (!acc) {
      return {
        text: '🙃 Аккаунт не найден',
        keyboard: new InlineKeyboard().text('⬅️ Назад', 'ui:list'),
      };
    }

    const status = acc.enabled ? '✅ включён' : '⛔ выключен';
    const since = acc.sinceId ? `<code>${acc.sinceId}</code>` : '—';

    const text =
      `🛰️ <b>Аккаунт</b>\n\n` +
      `<a href="https://x.com/${acc.xUsername}">@${acc.xUsername}</a>\n` +
      `Статус: ${status}\n` +
      `since_id: ${since}`;

    const kb = new InlineKeyboard();
    kb.text(acc.enabled ? '⛔ Выключить' : '✅ Включить', `acc:toggle:${acc.id}`).row();
    kb.text('🗑 Удалить', `acc:delask:${acc.id}`).row();
    kb.text('⬅️ Назад к списку', 'ui:list');

    return { text, keyboard: kb };
  }

  async function addAccountByUsername(ctx: any, xUsername: string) {
    const a = await prisma.account.upsert({
      where: { xUsername },
      create: { xUsername },
      update: { enabled: true },
    });

    const { text: listText, keyboard } = await renderAccountsMessage();
    await ctx.reply(`✅ Добавил/включил: @${a.xUsername}`);
    await ctx.reply(listText, { ...HTML_NO_PREVIEW, reply_markup: keyboard });
  }

  async function promptAdd(ctx: any) {
    state.awaitingAddUsernames = true;
    await ctx.reply(
      'Отправь юзернейм или ссылку на профиль X, например:\n' +
        '<code>kkulebaev</code>\n' +
        '<code>https://x.com/kkulebaev</code>',
      {
        ...HTML_NO_PREVIEW,
        reply_markup: new InlineKeyboard().text('❌ Отмена', 'ui:list'),
      },
    );
  }

  bot.command('start', async (ctx) => {
    mustAdmin(ctx.from?.id);
    const { text, keyboard } = await renderAccountsMessage();
    await ctx.reply(text, { ...HTML_NO_PREVIEW, reply_markup: keyboard });
  });

  bot.command('help', async (ctx) => {
    mustAdmin(ctx.from?.id);
    await ctx.reply(
      '🛰️ <b>Voyager</b> — админка\n\n' +
        'Команды:\n' +
        '<code>/list</code> — список аккаунтов\n' +
        '<code>/add kkulebaev</code> — добавить аккаунт\n' +
        '<code>/run</code> — запустить сбор вручную',
      { ...HTML_NO_PREVIEW },
    );
  });

  bot.command('list', async (ctx) => {
    mustAdmin(ctx.from?.id);
    const { text, keyboard } = await renderAccountsMessage();
    await ctx.reply(text, { ...HTML_NO_PREVIEW, reply_markup: keyboard });
  });

  bot.command('add', async (ctx) => {
    mustAdmin(ctx.from?.id);
    const text = String(ctx.match ?? '').trim();

    if (!text) {
      await promptAdd(ctx);
      return;
    }

    const one = extractFirstUsername(text);
    if (!one) {
      await ctx.reply('Не вижу юзернейм/ссылку. Пример: <code>/add kkulebaev</code>', { ...HTML_NO_PREVIEW });
      return;
    }

    state.awaitingAddUsernames = false;
    await addAccountByUsername(ctx, one);
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

  // If user pressed "Добавить" and then sent a message with usernames
  bot.on('message:text', async (ctx) => {
    if (!state.awaitingAddUsernames) return;
    mustAdmin(ctx.from?.id);

    const text = String(ctx.message.text ?? '').trim();
    // ignore commands
    if (text.startsWith('/')) return;

    const one = extractFirstUsername(text);
    if (!one) {
      await ctx.reply('Не вижу юзернейм/ссылку. Пример: <code>kkulebaev</code>', { ...HTML_NO_PREVIEW });
      return;
    }

    state.awaitingAddUsernames = false;
    await addAccountByUsername(ctx, one);
  });

  bot.on('callback_query:data', async (ctx) => {
    mustAdmin(ctx.from?.id);
    const data = String(ctx.callbackQuery.data);
    await ctx.answerCallbackQuery();

    // Simple UI actions
    if (data === 'ui:list') {
      state.awaitingAddUsernames = false;
      const { text, keyboard } = await renderAccountsMessage();
      if (ctx.callbackQuery.message) {
        try {
          await ctx.editMessageText(text, { ...HTML_NO_PREVIEW, reply_markup: keyboard });
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
      await promptAdd(ctx);
      return;
    }

    // Per-account actions
    if (data.startsWith('acc:open:')) {
      const id = data.split(':')[2];
      const { text, keyboard } = await renderAccountCard(id);
      if (ctx.callbackQuery.message) {
        try {
          await ctx.editMessageText(text, { ...HTML_NO_PREVIEW, reply_markup: keyboard });
        } catch (e) {
          if (!isMessageNotModifiedError(e)) throw e;
        }
      }
      return;
    }

    if (data.startsWith('acc:toggle:')) {
      const id = data.split(':')[2];
      const acc = await prisma.account.findUnique({ where: { id } });
      if (!acc) return;
      await prisma.account.update({ where: { id }, data: { enabled: !acc.enabled } });

      // stay on the account card
      const { text, keyboard } = await renderAccountCard(id);
      if (ctx.callbackQuery.message) {
        try {
          await ctx.editMessageText(text, { ...HTML_NO_PREVIEW, reply_markup: keyboard });
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

      const kb = new InlineKeyboard().text('🗑 Удалить', `acc:delyes:${id}`).text('❌ Отмена', `acc:open:${id}`);

      try {
        await ctx.editMessageText(`Удалить <b>@${acc.xUsername}</b>?`, { ...HTML_NO_PREVIEW, reply_markup: kb });
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
          await ctx.editMessageText(text, { ...HTML_NO_PREVIEW, reply_markup: keyboard });
        } catch (e) {
          if (!isMessageNotModifiedError(e)) throw e;
        }
      }
      return;
    }
  });

  return bot;
}
