import { mustEnv } from './env.js';

export type XUser = {
  id: string;
  username: string;
};

export type XTweet = {
  id: string;
  text: string;
  created_at?: string;
};

const BASE = 'https://api.x.com/2';

function authHeaders() {
  const token = mustEnv('X_BEARER_TOKEN');
  return {
    authorization: `Bearer ${token}`,
  };
}

async function xFetch<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  const url = new URL(BASE + path);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === '') continue;
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url, {
    headers: {
      ...authHeaders(),
      'user-agent': 'x-tweet-tracker/0.1',
    },
  });

  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }

  if (!res.ok) {
    const msg = json?.detail || json?.title || `${res.status} ${res.statusText}`;
    const err = new Error(`X API error: ${msg}`);
    (err as any).status = res.status;
    (err as any).body = json;
    throw err;
  }

  return json as T;
}

export async function getUserByUsername(username: string): Promise<XUser> {
  const clean = username.replace(/^@/, '').trim();
  const r = await xFetch<{ data: { id: string; username: string } }>(`/users/by/username/${encodeURIComponent(clean)}`);
  return r.data;
}

export async function getUserTweets(args: {
  userId: string;
  sinceId?: string | null;
  maxResults?: number;
}): Promise<{ tweets: XTweet[]; newestId?: string }> {
  const max = Math.min(Math.max(args.maxResults ?? 50, 5), 100);

  const r = await xFetch<{
    data?: XTweet[];
    meta?: { newest_id?: string; result_count?: number };
  }>(`/users/${encodeURIComponent(args.userId)}/tweets`, {
    // fields
    'tweet.fields': 'created_at',
    // paging
    since_id: args.sinceId ?? undefined,
    max_results: String(max),
    // keep it simple, ignore retweets/replies for MVP? (can be customized later)
    // exclude: 'replies,retweets',
  });

  return { tweets: r.data ?? [], newestId: r.meta?.newest_id };
}

export function tweetUrl(username: string, tweetId: string) {
  const clean = username.replace(/^@/, '').trim();
  return `https://x.com/${clean}/status/${tweetId}`;
}
