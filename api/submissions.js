import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const round = req.query.round;
    if (!round) return res.status(400).json({ error: 'round is required' });
    const keys = await redis.keys(`submission:${round}:*`);
    let subs = [];
    if (keys.length) {
      const values = await redis.mget(...keys);
      subs = values.filter(Boolean);
    }
    return res.status(200).json(subs);
  }

  if (req.method === 'POST') {
    const { round, id, name, branding, product, growth, social } = req.body || {};
    if (!round || !id) return res.status(400).json({ error: 'round and id are required' });
    const payload = {
      name: (name || 'Unnamed').slice(0, 60),
      branding: (branding || '').slice(0, 500),
      product: (product || '').slice(0, 500),
      growth: (growth || '').slice(0, 500),
      social: (social || '').slice(0, 500),
      submittedAt: Date.now()
    };
    await redis.set(`submission:${round}:${id}`, payload);
    return res.status(200).json({ ok: true });
  }

  return res.status(405).end();
}
