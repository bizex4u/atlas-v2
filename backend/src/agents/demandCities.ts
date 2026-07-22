import { callLLM } from '../utils/llm.js';
import { getAgentEvidence } from './context.js';
import type { AgentContext } from './types.js';

/**
 * Demand-signal geography — the "advertise where interest is high" model.
 *
 * Instead of asking "where are the brand's stores" (locator data is rarely
 * scrapable → real retailers fail), ask "which Indian cities show real demand
 * for this brand" — grounded ONLY in the retrieved evidence (news of sales,
 * expansion, launches, popularity by city). Groq extracts city + a 0-100
 * signal + the evidence-cited reason. Never invents cities not supported by
 * the evidence text.
 */
export interface DemandCity {
  city: string;
  demandScore: number; // 0-100
  reason: string; // cited from evidence — why advertise here
}

export async function extractDemandCities(
  brandName: string,
  category: string,
  context: AgentContext,
): Promise<DemandCity[]> {
  const evidence = getAgentEvidence(context);
  if (!evidence.length) return [];

  const { data } = await callLLM<{ cities?: Array<Partial<DemandCity>> }>({
    prompt: `Identify Indian CITIES where "${brandName}"${category ? ` (${category})` : ''} shows real demand or market presence, using ONLY the EVIDENCE.
Signals of demand: the brand's sales/popularity in a city, store or outlet openings, expansion announcements, regional strength, events, or news tying the brand to a specific Indian city.
Rules:
- ONLY cities explicitly supported by the evidence text. If a city is not in the evidence, do NOT include it.
- Real Indian city names only (e.g. Lucknow, Kanpur, Kolkata, Patna). No states, no regions, no countries.
- demandScore 0-100 = how strongly the evidence ties the brand to that city (more/stronger mentions = higher).
- reason = one short clause quoting/paraphrasing the evidence for that city.
- Return [] if the evidence names no specific cities. Never invent.`,
    evidence,
    evidenceQuery: `${brandName} cities market presence demand sales expansion India`,
    maxRetries: 2,
    signal: context.signal,
    schema: `{ "cities": [{ "city": string, "demandScore": number, "reason": string }] }`,
  });

  const raw = data?.cities ?? [];
  const seen = new Set<string>();
  const out: DemandCity[] = [];
  for (const c of raw) {
    const city = typeof c?.city === 'string' ? c.city.trim() : '';
    if (!city) continue;
    const key = city.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const score = Number(c?.demandScore);
    out.push({
      city,
      demandScore: Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score))) : 50,
      reason: typeof c?.reason === 'string' ? c.reason.slice(0, 200) : '',
    });
  }
  return out.sort((a, b) => b.demandScore - a.demandScore).slice(0, 8);
}
