import 'dotenv/config';
import { mustEnv } from './env.js';

async function main() {
  const base = mustEnv('API_BASE_URL').replace(/\/$/, '');
  const token = mustEnv('API_TOKEN');

  const res = await fetch(base + '/admin/run', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`API call failed: ${res.status} ${res.statusText} :: ${text}`);
  }

  console.log(text);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exitCode = 1;
});
