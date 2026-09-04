import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

const productAudienceMap = {
  "A pillow that remembers your dreams": [
    "People already into health and wellness — tracking sleep, water, fitness",
    "People buying a gift for someone else",
    "People who love trying new gadgets",
    "People who enjoy treating themselves to small daily comforts"
  ],
  "A toothbrush that tracks brushing habits and flags spots you miss": [
    "People who want to save time — busy, will pay to skip a step",
    "People already into health and wellness — tracking sleep, water, fitness",
    "People who love trying new gadgets"
  ],
  "A winter jacket with heating panels you can adjust from an app": [
    "People just settling into a new home",
    "People who spend a lot of time outdoors",
    "People who compare prices before buying anything"
  ],
  "A self-stirring coffee mug": [
    "People who want to save time — busy, will pay to skip a step",
    "People just settling into a new home",
    "People buying a gift for someone else",
    "People who enjoy treating themselves to small daily comforts",
    "People who work from home most days"
  ],
  "A subscription meal-kit box": [
    "People who want to save time — busy, will pay to skip a step",
    "People who compare prices before buying anything",
    "People who work from home most days"
  ],
  "A smart dog collar with GPS": [
    "First-time pet owners",
    "People who spend a lot of time outdoors"
  ],
  "A reusable water bottle that tracks intake": [
    "People already into health and wellness — tracking sleep, water, fitness",
    "People who spend a lot of time outdoors",
    "People who love trying new gadgets",
    "People who compare prices before buying anything",
    "People who work from home most days"
  ],
  "A weekly fresh flower subscription": [
    "People just settling into a new home",
    "People buying a gift for someone else",
    "People who enjoy treating themselves to small daily comforts"
  ]
};

const twists = [
  "You have to explain it using a food analogy",
  "Explain it to someone who's never used a smartphone",
  "It's already sold out once, and this is the restock announcement",
  "You're announcing it during a competitor's biggest sale of the year",
  "You're relaunching it after quietly discontinuing it last year",
  "It's more expensive than your competitor",
  "A celebrity was just spotted using it, unprompted",
  "You've launched it before and people hated the first version"
];

function pickScenario() {
  const products = Object.keys(productAudienceMap);
  const product = products[Math.floor(Math.random() * products.length)];
  const opts = productAudienceMap[product];
  const audience = opts[Math.floor(Math.random() * opts.length)];
  const twist = twists[Math.floor(Math.random() * twists.length)];
  return { product, audience, twist };
}

function checkHostKey(req, res) {
  const provided = req.headers['x-host-key'];
  if (!process.env.HOST_KEY || provided !== process.env.HOST_KEY) {
    res.status(401).json({ error: 'Not authorized as host.' });
    return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const state = (await redis.get('session-state')) || null;
    return res.status(200).json(state);
  }

  if (req.method === 'POST') {
    if (!checkHostKey(req, res)) return;

    const { action, pillar, label } = req.body || {};

    if (action === 'verify') {
      return res.status(200).json({ ok: true });
    }

    if (action === 'reset') {
      await redis.del('session-state');
      const subKeys = await redis.keys('submission:*');
      if (subKeys.length) await redis.del(...subKeys);
      return res.status(200).json({ ok: true });
    }

    let state = (await redis.get('session-state')) || null;

    if (action === 'spin') {
      const scenario = pickScenario();
      const duration = (state && state.timerDuration) || 300;
      state = {
        round: (state ? state.round : 0) + 1,
        product: scenario.product,
        audience: scenario.audience,
        twist: scenario.twist,
        timerDuration: duration,
        timerRunning: false,
        endsAt: null,
        remaining: duration,
        locked: false,
        spotlight: null,
        spotlightHistory: [],
        updatedAt: Date.now()
      };
    } else if (!state) {
      return res.status(400).json({ error: 'No round started yet — spin first.' });
    } else if (action === 'toggleTimer') {
      if (state.timerRunning) {
        const remaining = Math.max(0, (state.endsAt - Date.now()) / 1000);
        state = { ...state, timerRunning: false, remaining, endsAt: null, updatedAt: Date.now() };
      } else {
        const remaining = state.remaining ?? state.timerDuration ?? 300;
        state = { ...state, timerRunning: true, endsAt: Date.now() + remaining * 1000, updatedAt: Date.now() };
      }
    } else if (action === 'resetTimer') {
      state = { ...state, timerRunning: false, remaining: state.timerDuration, endsAt: null, updatedAt: Date.now() };
    } else if (action === 'addMinute') {
      if (state.timerRunning) {
        state = { ...state, endsAt: state.endsAt + 60000, updatedAt: Date.now() };
      } else {
        const newDuration = (state.timerDuration || 300) + 60;
        state = {
          ...state,
          timerDuration: newDuration,
          remaining: (state.remaining ?? state.timerDuration ?? 300) + 60,
          updatedAt: Date.now()
        };
      }
    } else if (action === 'toggleLock') {
      state = { ...state, locked: !state.locked, updatedAt: Date.now() };
    } else if (action === 'spotlight') {
      const keys = await redis.keys(`submission:${state.round}:*`);
      let subs = [];
      if (keys.length) {
        const values = await redis.mget(...keys);
        subs = values.filter(Boolean);
      }
      const withAnswer = subs.filter((s) => s[pillar] && s[pillar].trim());
      if (!withAnswer.length) {
        return res.status(200).json({ ...state, spotlightError: 'No answers yet for ' + label });
      }
      const pick = withAnswer[Math.floor(Math.random() * withAnswer.length)];
      state = { ...state, spotlight: { pillar, name: pick.name, answer: pick[pillar] }, updatedAt: Date.now() };
    } else {
      return res.status(400).json({ error: 'Unknown action.' });
    }

    await redis.set('session-state', state);
    return res.status(200).json(state);
  }

  return res.status(405).end();
}
