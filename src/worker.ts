import { prisma } from './prisma.js';
import { getUserByUsername, getUserTweets, tweetUrl } from './x-api.js';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimitError(e: unknown) {
  const status = (e as any)?.status;
  return status === 429;
}

export type RunResult = {
  accountsTotal: number;
  accountsProcessed: number;
  tweetsInserted: number;
  errors: Array<{ xUsername: string; error: string }>;
};

export async function runWorkerOnce(): Promise<RunResult> {
  const accounts = await prisma.account.findMany({ where: { enabled: true }, orderBy: { createdAt: 'asc' } });

  const result: RunResult = {
    accountsTotal: accounts.length,
    accountsProcessed: 0,
    tweetsInserted: 0,
    errors: [],
  };

  for (const acc of accounts) {
    try {
      // Resolve user id if needed
      let xUserId = acc.xUserId;
      if (!xUserId) {
        const u = await getUserByUsername(acc.xUsername);
        xUserId = u.id;
        await prisma.account.update({ where: { id: acc.id }, data: { xUserId } });
      }

      // Keep API usage low: fetch a small page and store only the latest tweet.
      const { tweets, newestId } = await getUserTweets({ userId: xUserId!, sinceId: acc.sinceId, maxResults: 5 });

      // Store up to 5 latest tweets returned by API.
      // Insert oldest -> newest for nicer ordering in logs.
      const sorted = [...tweets].sort((a, b) => (a.id < b.id ? -1 : 1));

      for (const t of sorted) {
        const createdAt = t.created_at ? new Date(t.created_at) : new Date();
        await prisma.tweet.upsert({
          where: { tweetId: t.id },
          create: {
            tweetId: t.id,
            accountId: acc.id,
            createdAt,
            text: t.text,
            url: tweetUrl(acc.xUsername, t.id),
            raw: t as any,
          },
          update: {
            // keep latest text/url just in case
            text: t.text,
            url: tweetUrl(acc.xUsername, t.id),
            raw: t as any,
          },
        });
        result.tweetsInserted += 1;
      }

      // update sinceId to newest_id returned by API (or to selected latest for first run)
      const nextSinceId = newestId || (sorted.length ? sorted[sorted.length - 1].id : null);
      if (nextSinceId) {
        await prisma.account.update({ where: { id: acc.id }, data: { sinceId: nextSinceId } });
      }

      result.accountsProcessed += 1;

      // small delay to avoid bursts
      await sleep(250);
    } catch (e) {
      if (isRateLimitError(e)) {
        // backoff and continue
        result.errors.push({ xUsername: acc.xUsername, error: 'Rate limited (429). Backing off.' });
        await sleep(30_000);
        continue;
      }

      result.errors.push({ xUsername: acc.xUsername, error: String((e as any)?.message ?? e) });
    }
  }

  return result;
}
