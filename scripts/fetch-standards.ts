// Look up the official City of Ottawa / Ontario service standard for every issue category, once,
// and bake it into lib/standards.json so the app never has to search at request time.
//   npx tsx scripts/fetch-standards.ts            every category
//   npx tsx scripts/fetch-standards.ts pothole    just the named ones (merged into the existing file)
//
// One Gemini call per category, grounded with Google Search + URL context. If the structured call
// fails, it is retried exactly once without the response schema. Nothing is invented: a standard
// the model can't source comes back with targetHours null and low confidence, and stays that way.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { genai, MODELS } from '../lib/ai';
import { CATEGORIES, CATEGORY_IDS, type CategoryId } from '../lib/categories';
import type { CityStandard, StandardsFile } from '../lib/standards';

try {
  process.loadEnvFile('.env.local');
} catch {
  /* env from the shell */
}

const OUT = 'lib/standards.json';

const SCHEMA = {
  type: 'object',
  properties: {
    category: { type: 'string' },
    standard: { type: 'string', description: 'One sentence stating the official standard, as the source states it.' },
    targetHours: { type: ['number', 'null'], description: 'The response/repair target in hours, or null if no official number was found.' },
    roadClassNote: { type: 'string', description: 'If the target varies by road class or priority, the full breakdown. Empty string otherwise.' },
    sourceUrl: { type: 'string' },
    sourceTitle: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['category', 'standard', 'targetHours', 'roadClassNote', 'sourceUrl', 'sourceTitle', 'confidence'],
};

// what each category means in the app, so the search looks for the right standard
const WHAT: Record<CategoryId, string> = {
  pothole: 'repairing potholes on city roads (Ontario Regulation 239/02, Minimum Maintenance Standards for Municipal Highways, pothole repair times by road class; and any City of Ottawa pothole repair target)',
  sidewalk: 'repairing sidewalk surface discontinuities / trip hazards (Ontario Regulation 239/02 section on sidewalk surface discontinuities; City of Ottawa sidewalk repair)',
  streetlight: 'repairing a streetlight that is out (City of Ottawa streetlight outage repair target; O. Reg. 239/02 luminaire standard if relevant)',
  traffic: 'repairing a damaged or missing regulatory/warning sign or a malfunctioning traffic signal (O. Reg. 239/02 regulatory sign standard; City of Ottawa traffic signal response)',
  bike_lane: 'clearing or maintaining a blocked or obstructed bicycle lane (O. Reg. 239/02 bicycle lane standards; City of Ottawa bike lane maintenance)',
  water: 'responding to a water main break, leak or no-water call (City of Ottawa water services response standard)',
  drainage: 'responding to flooding, a blocked catch basin or storm drain (City of Ottawa drainage / catch basin response)',
  waste: 'responding to a missed garbage or recycling collection or illegal dumping on city property (City of Ottawa solid waste service standard)',
  graffiti: 'removing graffiti from city property, or the deadline for owners to remove graffiti (City of Ottawa graffiti management / by-law removal target)',
  tree: 'responding to a fallen or hazardous city tree or a park maintenance request (City of Ottawa Forestry Services response)',
  other: 'a general ServiceOttawa 311 service request (City of Ottawa 311 service standard / response time)',
};

const prompt = (id: CategoryId) => `Find the OFFICIAL published service standard in Ottawa, Ontario, Canada for: ${WHAT[id]}.

Rules:
- Search the web. Strongly prefer ottawa.ca, ontario.ca/laws (e-Laws) and other official government sources. Use the page itself, not a news story, when you can.
- Only report a number the source actually states. If you cannot find an official number, set targetHours to null and confidence to "low". Never estimate or assume.
- targetHours is the target converted to hours (e.g. 4 days = 96, 24 hours = 24).
- If the target varies by road class or priority, set targetHours to the value for a Class 3 road (a typical Ottawa urban collector) or the standard/default priority, and put the full breakdown in roadClassNote.
- sourceUrl must be the real URL of the official page you used (not a search redirect link). sourceTitle is that page's title.
- confidence: "high" = the number is stated verbatim on an official page you read; "medium" = official but indirect, or the category only partly matches; "low" = no official number or unsure.
- category must be "${id}".

Answer with JSON only: {"category","standard","targetHours","roadClassNote","sourceUrl","sourceTitle","confidence"}.`;

interface Raw {
  category: string;
  standard: string;
  targetHours: number | null;
  roadClassNote?: string;
  sourceUrl: string;
  sourceTitle: string;
  confidence: 'high' | 'medium' | 'low';
}

function parse(text: string): Raw {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('no JSON in answer');
  return JSON.parse(m[0]) as Raw;
}

async function fetchOne(id: CategoryId): Promise<CityStandard> {
  const ai = genai();
  if (!ai) throw new Error('no model configured (VERTEX_EXPRESS_KEY or GEMINI_API_KEY)');
  const tools = [{ googleSearch: {} }, { urlContext: {} }];
  const call = (structured: boolean) =>
    ai.models.generateContent({
      model: MODELS.decide(),
      contents: [{ role: 'user', parts: [{ text: prompt(id) }] }],
      config: structured
        ? { tools, responseMimeType: 'application/json', responseJsonSchema: SCHEMA, temperature: 0 }
        : { tools, temperature: 0 },
    });

  let res;
  try {
    res = await call(true);
  } catch (e) {
    console.warn(`  ${id}: structured call failed (${(e as Error).message.slice(0, 160)}), retrying once without schema`);
    res = await call(false);
  }
  const raw = parse(res.text ?? '');
  const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const grounding = [...new Set(chunks.map((c) => c.web?.title || c.web?.domain).filter((x): x is string => !!x))];

  const hours = typeof raw.targetHours === 'number' && isFinite(raw.targetHours) && raw.targetHours > 0 ? raw.targetHours : null;
  const confidence = raw.confidence === 'high' || raw.confidence === 'medium' ? raw.confidence : 'low';
  return {
    category: id,
    standard: String(raw.standard ?? '').trim(),
    targetHours: hours,
    roadClassNote: raw.roadClassNote?.trim() || undefined,
    sourceUrl: String(raw.sourceUrl ?? '').trim(),
    sourceTitle: String(raw.sourceTitle ?? '').trim(),
    confidence,
    // anything a human should look at before it's quoted to a resident
    needsReview: confidence === 'low' || hours === null || !/^https?:\/\//.test(raw.sourceUrl ?? '') || undefined,
    grounding,
  };
}

async function main() {
  const only = process.argv.slice(2).filter((a) => a in CATEGORIES) as CategoryId[];
  const ids = only.length ? only : CATEGORY_IDS;
  const prev: StandardsFile | null = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
  // a re-fetch replaces the entry, including any human review note on it
  const standards: StandardsFile['standards'] = { ...(prev?.standards ?? {}) };

  for (const id of ids) {
    process.stdout.write(`${id} … `);
    try {
      const s = await fetchOne(id);
      standards[id] = s;
      console.log(`${s.targetHours ?? 'null'} h, ${s.confidence}${s.needsReview ? ' (needs review)' : ''} — ${s.sourceTitle}`);
    } catch (e) {
      console.log(`failed: ${(e as Error).message.slice(0, 200)}`);
    }
  }

  const out: StandardsFile = { fetchedAt: new Date().toISOString(), model: MODELS.decide(), standards };
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
  console.log(`wrote ${OUT} (${Object.keys(standards).length} categories)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
