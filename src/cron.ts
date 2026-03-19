import 'dotenv/config';
import { runWorkerOnce } from './worker.js';
import { prisma } from './prisma.js';

try {
  const r = await runWorkerOnce();
  console.log(JSON.stringify({ ok: true, ...r }, null, 2));
} catch (e) {
  console.error('ERROR:', e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect().catch(() => {});
}
