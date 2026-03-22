import Redis from 'ioredis';

function env(key: string) {
  return (process.env[key] ?? '').trim();
}

export function redisEnabled() {
  return Boolean(env('REDIS_URL'));
}

let redisClient: Redis | null = null;

export function redis() {
  if (!redisClient) {
    redisClient = new Redis(env('REDIS_URL'), {
      maxRetriesPerRequest: 2,
    });

    redisClient.on('error', (e) => {
      console.warn('redis error', String((e as any)?.message ?? e));
    });
  }
  return redisClient;
}

export const STREAM_KEY = 'voyager:tweets';

export type RedisTweetEvent = {
  type: 'tweet.upserted';
  tweetId: string;
  accountId: string;
  xUsername: string | null;
  createdAt: string;
  text: string;
  url: string;
};

export async function publishTweetsToStream(events: RedisTweetEvent[]) {
  if (!redisEnabled()) return { ok: false, skipped: true as const };
  if (!events.length) return { ok: true, sent: 0 };

  const r = redis();

  const start = Date.now();
  let lastId: string | null = null;

  for (const e of events) {
    // Keep payload as single JSON field for easy consumers (n8n, etc.)
    lastId = await r.xadd(
      STREAM_KEY,
      '*',
      'tweetId',
      e.tweetId,
      'payload',
      JSON.stringify(e),
    );
  }

  const ms = Date.now() - start;
  console.log(`redis xadd ${STREAM_KEY}: ${events.length} events (${ms}ms) lastId=${lastId ?? '-'}`);

  return { ok: true, sent: events.length };
}
