import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { CATEGORY_IDS, category, type CategoryId } from './categories';
import {
  CHARACTER_ANIMATIONS,
  CHARACTER_EMOTIONS,
  CHARACTER_OUTFITS,
  CHARACTER_PROPS,
  type Analysis,
  type CharacterDecision,
} from './types';

const CITY = process.env.NEXT_PUBLIC_CITY || 'Ottawa';

const SCHEMA = {
  type: 'object',
  properties: {
    isCivicIssue: { type: 'boolean', description: 'false if nothing in the frame is a public-infrastructure problem' },
    category: { type: 'string', enum: CATEGORY_IDS },
    title: { type: 'string', description: 'What and where in the frame, max 7 words, sentence case. e.g. "Deep pothole in the curb lane"' },
    summary: { type: 'string', description: 'One or two plain sentences a city crew could act on. Mention size/extent estimates.' },
    infrastructure: { type: 'string', description: 'The asset affected, e.g. "road surface", "sidewalk slab", "street light pole"' },
    severity: { type: 'integer', minimum: 0, maximum: 100, description: 'How damaged/broken it is' },
    safetyRisk: { type: 'integer', minimum: 0, maximum: 100, description: 'Likelihood × harm to people (drivers, cyclists, pedestrians)' },
    hazards: { type: 'array', items: { type: 'string' }, description: 'Short phrases: "trip hazard", "tire damage", "cyclist swerve risk"' },
    accessibility: {
      type: 'object',
      properties: {
        barrier: { type: 'boolean' },
        impact: { type: 'string', enum: ['none', 'low', 'moderate', 'critical'] },
        notes: { type: 'array', items: { type: 'string' }, description: 'Who is blocked and how, e.g. "Wheelchair users cannot pass: slab lifted ~4 cm"' },
      },
      required: ['barrier', 'impact', 'notes'],
    },
    box: {
      type: 'array',
      items: { type: 'integer' },
      description: 'Bounding box of the problem in the PHOTO as [ymin, xmin, ymax, xmax] normalised 0-1000. Empty array if none.',
    },
    transcript: { type: 'string', description: 'What the person said in the video, verbatim. Empty if no speech.' },
    mayorLine: {
      type: 'string',
      description:
        'What the tiny cartoon mayor mascot says out loud after inspecting it. Max 14 words, casual, warm, a bit funny, city-worker energy, no politics, never mocks the resident. e.g. "Yeah… we’re gonna have to fix that." / "That’s not a pothole, that’s a swimming pool."',
    },
    mood: { type: 'string', enum: ['dismayed', 'determined', 'impressed', 'confused'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    character: {
      type: 'object',
      description: 'How the tiny Mamdani character presents this, chosen ONLY from the listed options.',
      properties: {
        outfit: {
          type: 'string',
          enum: [...CHARACTER_OUTFITS],
          description:
            'CONSTRUCTION for roads, sidewalks, water, drainage, signals; SANITATION for garbage/graffiti; INSPECTOR for accessibility, trees, anything needing assessment; DEFAULT for non-infrastructure complaints.',
        },
        animation: {
          type: 'string',
          enum: [...CHARACTER_ANIMATIONS],
          description:
            'PLACE_FLAG marks a spot on the ground (potholes, broken slabs). PLACE_CONE blocks off a hazard people could walk or ride into. CHECK_CLIPBOARD for assessments (accessibility, trees, bins). LOOK_UP for things overhead (streetlights, signs, signals). INSPECT_GROUND for small or subtle damage. POINT_AT_ISSUE / SHAKE_HEAD / ACKNOWLEDGE otherwise.',
        },
        prop: {
          type: 'string',
          enum: [...CHARACTER_PROPS],
          description: 'Must fit the animation: PLACE_FLAG=WARNING_FLAG, PLACE_CONE=TRAFFIC_CONE, CHECK_CLIPBOARD=CLIPBOARD, LOOK_UP/INSPECT_GROUND=FLASHLIGHT, else NONE.',
        },
        emotion: { type: 'string', enum: [...CHARACTER_EMOTIONS] },
        response: {
          type: 'string',
          description:
            'What he says out loud after the action, to the resident. Max 16 words. Warm, casual, a bit funny, city-worker energy. Confirms it is marked for the city. No politics, never mocks the resident, never promises a date.',
        },
      },
      required: ['outfit', 'animation', 'prop', 'emotion', 'response'],
    },
    clarification: {
      type: 'object',
      description: 'Only when two DIFFERENT problems are plausible and you truly cannot tell which one the resident means. Otherwise needed=false.',
      properties: {
        needed: { type: 'boolean' },
        question: { type: 'string', description: 'One short spoken question from Mamdani, e.g. "Is it the broken curb or the blocked sidewalk?"' },
        options: { type: 'array', items: { type: 'string' }, description: '2 or 3 short tappable answers, 1-4 words each' },
      },
      required: ['needed', 'question', 'options'],
    },
  },
  required: [
    'isCivicIssue', 'category', 'title', 'summary', 'infrastructure', 'severity', 'safetyRisk', 'hazards',
    'accessibility', 'box', 'transcript', 'mayorLine', 'mood', 'confidence', 'character', 'clarification',
  ],
};

const PROMPT = `You are the intake inspector for the City of ${CITY}'s public-works department.
A resident pointed their phone at something in the city and said "Mamdani, fix this."
You get the photo they framed${'' /* video appended when present */} and possibly a short video with their voice.

Decide what public-infrastructure problem is shown and turn it into a report a crew can act on.
- Judge from what you can SEE. Use the voice only for context (location hints, how long it's been there).
- The resident may be casual, sarcastic or swear. Translate that into a neutral report.
- Look beyond what they said: note accessibility barriers they may not have mentioned
  (lifted or cracked sidewalk slabs, missing curb cuts, obstructions narrowing a sidewalk, ponding at crossings, missing tactile plates).
  Changes in level over ~1.3 cm on a pedestrian route are a trip hazard and a wheelchair barrier.
- Severity is about the asset. Safety risk is about people. Keep them separate.
- The box must tightly frame the problem in the photo (not the whole road).
- If nothing is a public-infrastructure problem, set isCivicIssue false, category "other", and have the mayor gently ask what's wrong.`;

let client: GoogleGenAI | null = null;
const gemini = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  client ??= new GoogleGenAI({ apiKey });
  return client;
};

export const hasGemini = () => !!process.env.GEMINI_API_KEY;

export const TEXT_MODEL = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';

export async function analyze(input: {
  photo: { data: Buffer; mime: string };
  video?: { data: Buffer; mime: string } | null;
  hint?: string;
  /** what the resident and Mamdani said before the shutter (from the live session) */
  context?: string;
  /** the resident's answer to Mamdani's clarifying question */
  answer?: string;
  /** true on the retry after a clarification: decide now, don't ask again */
  final?: boolean;
}): Promise<Analysis> {
  const ai = gemini();
  if (!ai) return demoAnalysis([input.hint, input.context, input.answer].filter(Boolean).join(' '));

  const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [
    { inlineData: { mimeType: input.photo.mime, data: input.photo.data.toString('base64') } },
  ];
  // inline video is fine for short clips; anything bigger falls back to the photo alone
  if (input.video && input.video.data.length < 18 * 1024 * 1024) {
    parts.push({ inlineData: { mimeType: input.video.mime.split(';')[0], data: input.video.data.toString('base64') } });
  }
  let text = PROMPT;
  if (input.hint) text += `\nThe resident typed: "${input.hint}"`;
  if (input.context) {
    text += `\n\nWhat was said while they pointed the camera (their live conversation with Mamdani, oldest first). Use it to understand which problem they mean and for context; judge the problem itself from the photo:\n${input.context.slice(-2500)}`;
  }
  if (input.answer) text += `\n\nMamdani asked which problem they meant. The resident answered: "${input.answer}". Report that one.`;
  if (input.final || input.answer) text += '\nDo not ask for clarification: set clarification.needed false.';
  parts.push({ text });

  const res = await ai.models.generateContent({
    model: TEXT_MODEL(),
    contents: [{ role: 'user', parts }],
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: SCHEMA,
      temperature: 0.3,
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    },
  });
  const raw = JSON.parse(res.text ?? '{}');
  return normalize(raw, 'gemini');
}

function clamp(n: unknown, lo = 0, hi = 100) {
  const v = typeof n === 'number' && isFinite(n) ? n : 0;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function normalize(r: Record<string, unknown>, engine: Analysis['engine']): Analysis {
  const cat = category(String(r.category ?? 'other')).id as CategoryId;
  const acc = (r.accessibility ?? {}) as Partial<Analysis['accessibility']>;
  const box = Array.isArray(r.box) && r.box.length === 4 ? (r.box.map((n) => clamp(n, 0, 1000)) as Analysis['box']) : null;
  return {
    isCivicIssue: r.isCivicIssue !== false,
    category: cat,
    title: String(r.title ?? category(cat).label),
    summary: String(r.summary ?? ''),
    infrastructure: String(r.infrastructure ?? ''),
    severity: clamp(r.severity),
    safetyRisk: clamp(r.safetyRisk),
    hazards: Array.isArray(r.hazards) ? r.hazards.map(String).slice(0, 5) : [],
    accessibility: {
      barrier: !!acc.barrier,
      impact: (['none', 'low', 'moderate', 'critical'] as const).includes(acc.impact as never) ? (acc.impact as Analysis['accessibility']['impact']) : 'none',
      notes: Array.isArray(acc.notes) ? acc.notes.map(String).slice(0, 4) : [],
    },
    box,
    transcript: String(r.transcript ?? ''),
    mayorLine: String(r.mayorLine ?? 'Yeah… we’re gonna have to fix that.'),
    mood: (['dismayed', 'determined', 'impressed', 'confused'] as const).includes(r.mood as never) ? (r.mood as Analysis['mood']) : 'determined',
    confidence: Math.max(0, Math.min(1, Number(r.confidence ?? 0.5))),
    engine,
    character: normalizeCharacter(r.character, cat, String(r.mayorLine ?? ''), String(r.mood ?? '')),
    clarification: normalizeClarification(r.clarification),
  };
}

// What he wears and does when the model doesn't say (or says something off-list).
const DEFAULT_ACT: Partial<Record<CategoryId, Pick<CharacterDecision, 'outfit' | 'animation'>>> = {
  pothole: { outfit: 'CONSTRUCTION', animation: 'PLACE_FLAG' },
  sidewalk: { outfit: 'INSPECTOR', animation: 'CHECK_CLIPBOARD' },
  streetlight: { outfit: 'CONSTRUCTION', animation: 'LOOK_UP' },
  traffic: { outfit: 'CONSTRUCTION', animation: 'LOOK_UP' },
  bike_lane: { outfit: 'CONSTRUCTION', animation: 'PLACE_CONE' },
  water: { outfit: 'CONSTRUCTION', animation: 'PLACE_CONE' },
  drainage: { outfit: 'CONSTRUCTION', animation: 'PLACE_CONE' },
  waste: { outfit: 'SANITATION', animation: 'CHECK_CLIPBOARD' },
  graffiti: { outfit: 'SANITATION', animation: 'POINT_AT_ISSUE' },
  tree: { outfit: 'INSPECTOR', animation: 'CHECK_CLIPBOARD' },
};
const PROP_FOR: Record<CharacterDecision['animation'], CharacterDecision['prop']> = {
  PLACE_FLAG: 'WARNING_FLAG',
  PLACE_CONE: 'TRAFFIC_CONE',
  CHECK_CLIPBOARD: 'CLIPBOARD',
  LOOK_UP: 'FLASHLIGHT',
  INSPECT_GROUND: 'FLASHLIGHT',
  POINT_AT_ISSUE: 'NONE',
  SHAKE_HEAD: 'NONE',
  ACKNOWLEDGE: 'NONE',
};
const EMOTION_FOR_MOOD: Record<string, CharacterDecision['emotion']> = {
  dismayed: 'CONCERNED',
  determined: 'DETERMINED',
  impressed: 'IMPRESSED',
  confused: 'CONFUSED',
};
const oneOf = <T extends string>(list: readonly T[], v: unknown, fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

function normalizeCharacter(raw: unknown, cat: CategoryId, mayorLine: string, mood: string): CharacterDecision {
  const c = (raw ?? {}) as Partial<Record<keyof CharacterDecision, unknown>>;
  const d = DEFAULT_ACT[cat] ?? { outfit: 'DEFAULT', animation: 'ACKNOWLEDGE' };
  const animation = oneOf(CHARACTER_ANIMATIONS, c.animation, d.animation);
  return {
    outfit: oneOf(CHARACTER_OUTFITS, c.outfit, d.outfit),
    animation,
    // the prop always matches the action, whatever the model said
    prop: PROP_FOR[animation],
    emotion: oneOf(CHARACTER_EMOTIONS, c.emotion, EMOTION_FOR_MOOD[mood] ?? 'DETERMINED'),
    response: String(c.response || mayorLine || 'Got it. I’ve marked this one for the city.').slice(0, 160),
  };
}

function normalizeClarification(raw: unknown): Analysis['clarification'] {
  const c = (raw ?? {}) as { needed?: unknown; question?: unknown; options?: unknown };
  const options = Array.isArray(c.options) ? c.options.map(String).filter(Boolean).slice(0, 3) : [];
  const question = String(c.question ?? '');
  return { needed: c.needed === true && !!question && options.length >= 2, question, options };
}

/** No key configured: a clearly-labelled canned analysis so the whole flow still works. */
function demoAnalysis(hint?: string): Analysis {
  const h = (hint || '').toLowerCase();
  const pick: CategoryId = /light|lamp|dark/.test(h)
    ? 'streetlight'
    : /sidewalk|curb|wheelchair|trip/.test(h)
      ? 'sidewalk'
      : /garbage|trash|litter|bin/.test(h)
        ? 'waste'
        : /bike/.test(h)
          ? 'bike_lane'
          : 'pothole';
  const presets: Record<string, Partial<Analysis>> = {
    pothole: {
      title: 'Deep pothole in the curb lane',
      summary: 'Pothole roughly 60 cm across and 8–10 cm deep with loose aggregate around the edge, sitting in the path of right-turning traffic.',
      infrastructure: 'road surface',
      severity: 84,
      safetyRisk: 71,
      hazards: ['tire and rim damage', 'cyclist swerve risk'],
      accessibility: { barrier: false, impact: 'low', notes: ['Near the crosswalk: pooled water will spill onto the crossing'] },
      mayorLine: 'Yeah… we’re gonna have to fix that.',
      mood: 'dismayed',
    },
    sidewalk: {
      title: 'Lifted sidewalk slab at the corner',
      summary: 'Slab heaved about 4 cm by tree roots, creating a lip across the full sidewalk width.',
      infrastructure: 'sidewalk slab',
      severity: 66,
      safetyRisk: 74,
      hazards: ['trip hazard'],
      accessibility: { barrier: true, impact: 'critical', notes: ['Wheelchair and walker users cannot pass the 4 cm lip', 'No alternate route without entering the road'] },
      mayorLine: 'Nobody’s rolling over that. Flag’s going in.',
      mood: 'determined',
    },
    streetlight: {
      title: 'Streetlight out over the crosswalk',
      summary: 'Pole-mounted luminaire is dark above a marked crossing.',
      infrastructure: 'street light',
      severity: 55,
      safetyRisk: 68,
      hazards: ['pedestrians hard to see at night'],
      accessibility: { barrier: false, impact: 'low', notes: ['Low-vision pedestrians lose the lit crossing'] },
      mayorLine: 'Lights out? Not on my watch. Well… on my flag.',
      mood: 'determined',
    },
    waste: {
      title: 'Overflowing public bin',
      summary: 'Litter bin full with bags stacked beside it on the sidewalk.',
      infrastructure: 'litter bin',
      severity: 38,
      safetyRisk: 15,
      hazards: ['litter blowing into the road'],
      accessibility: { barrier: true, impact: 'moderate', notes: ['Bags narrow the sidewalk to about 80 cm'] },
      mayorLine: 'That bin has seen things. Sending a truck.',
      mood: 'dismayed',
    },
    bike_lane: {
      title: 'Car parked in the bike lane',
      summary: 'Vehicle stopped fully inside the painted bike lane, forcing cyclists into traffic.',
      infrastructure: 'bike lane',
      severity: 45,
      safetyRisk: 70,
      hazards: ['cyclists merge into traffic'],
      accessibility: { barrier: false, impact: 'none', notes: [] },
      mayorLine: 'That’s a bike lane, not a parking spot. Noted.',
      mood: 'dismayed',
    },
  };
  return normalize(
    {
      isCivicIssue: true,
      category: pick,
      box: [470, 300, 760, 700],
      transcript: hint || '',
      confidence: 0.5,
      ...presets[pick],
    },
    'demo',
  );
}
