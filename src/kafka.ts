import { Kafka, logLevel } from 'kafkajs';

function kafkaLogLevel() {
  // In production we want warnings/errors, but avoid noisy debug logs
  return process.env.NODE_ENV === 'production' ? logLevel.WARN : logLevel.INFO;
}

function env(key: string) {
  return (process.env[key] ?? '').trim();
}

function normalizeBroker(broker: string) {
  // Railway uses INTERNAL://kafka.railway.internal:29092
  if (!broker) return '';
  return broker.replace(/^INTERNAL:\/\//i, '');
}

export function kafkaEnabled() {
  return Boolean(env('KAFKA_BROKER'));
}

const TOPIC = 'voyager.tweets';

const broker = normalizeBroker(env('KAFKA_BROKER'));
const brokers = broker ? [broker] : [];

const kafka = new Kafka({
  clientId: 'x-tweet-tracker-api',
  brokers,
  logLevel: kafkaLogLevel(),
});

let producerPromise: Promise<ReturnType<typeof kafka.producer>> | null = null;
let topicEnsured = false;

async function ensureTopic() {
  if (topicEnsured) return;

  const admin = kafka.admin();
  await admin.connect();
  try {
    await admin.createTopics({
      waitForLeaders: true,
      topics: [
        {
          topic: TOPIC,
          numPartitions: 1,
          replicationFactor: 1,
        },
      ],
    });
    topicEnsured = true;
  } catch (e) {
    // If topic already exists, treat as success
    const msg = String((e as any)?.message ?? e).toLowerCase();
    if (msg.includes('topic') && msg.includes('exists')) {
      topicEnsured = true;
      return;
    }
    throw e;
  } finally {
    await admin.disconnect().catch(() => {});
  }
}

async function getProducer() {
  if (!producerPromise) {
    const p = kafka.producer();
    producerPromise = p.connect().then(() => p);
  }
  return producerPromise;
}

export type KafkaTweetEvent = {
  type: 'tweet.upserted';
  tweetId: string;
  accountId: string;
  xUsername: string | null;
  createdAt: string;
  text: string;
  url: string;
};

export async function publishTweets(events: KafkaTweetEvent[]) {
  if (!kafkaEnabled()) return { ok: false, skipped: true as const };
  if (!events.length) return { ok: true, sent: 0 };

  await ensureTopic();

  const producer = await getProducer();

  await producer.send({
    topic: TOPIC,
    messages: events.map((e) => ({
      key: e.tweetId,
      value: JSON.stringify(e),
    })),
  });

  return { ok: true, sent: events.length };
}
