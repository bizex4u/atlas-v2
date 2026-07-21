import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { logAgentRaw, logWarn } from '../utils/logger.js';
import {
  type Agent,
  type AgentContext,
  type GeoHighway,
  type GeoMarket,
  type GeoResult,
  type StoreCity,
} from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type ZeptoStore = { city: string; lat: number; lng: number; name: string };

const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  mumbai: { lat: 19.076, lng: 72.8777 },
  delhi: { lat: 28.6139, lng: 77.209 },
  'new delhi': { lat: 28.6139, lng: 77.209 },
  bengaluru: { lat: 12.9716, lng: 77.5946 },
  bangalore: { lat: 12.9716, lng: 77.5946 },
  hyderabad: { lat: 17.385, lng: 78.4867 },
  chennai: { lat: 13.0827, lng: 80.2707 },
  pune: { lat: 18.5204, lng: 73.8567 },
  kolkata: { lat: 22.5726, lng: 88.3639 },
  ahmedabad: { lat: 23.0225, lng: 72.5714 },
  jaipur: { lat: 26.9124, lng: 75.7873 },
  chandigarh: { lat: 30.7333, lng: 76.7794 },
  lucknow: { lat: 26.8467, lng: 80.9462 },
  indore: { lat: 22.7196, lng: 75.8577 },
  surat: { lat: 21.1702, lng: 72.8311 },
  kochi: { lat: 9.9312, lng: 76.2673 },
  coimbatore: { lat: 11.0168, lng: 76.9558 },
};

const HIGHWAY_LOOKUP: Record<
  string,
  Array<{ nh: string; corridor: string; sites: string }>
> = {
  mumbai: [
    { nh: 'NH48', corridor: 'Mumbai–Pune Expressway approaches', sites: 'Sion / Panvel / Khopoli exits' },
    { nh: 'NH66', corridor: 'Western coastal', sites: 'Worli sea link approaches' },
  ],
  delhi: [
    { nh: 'NH48', corridor: 'Delhi–Jaipur', sites: 'Dwarka / Manesar stretch' },
    { nh: 'NH44', corridor: 'GT Road north', sites: 'Mukarba Chowk / Alipur' },
  ],
  bengaluru: [
    { nh: 'NH44', corridor: 'Bengaluru–Hyderabad', sites: 'Hebbal / Yelahanka' },
    { nh: 'NH75', corridor: 'ORR east', sites: 'KR Puram / Whitefield spur' },
  ],
  bangalore: [
    { nh: 'NH44', corridor: 'Bengaluru–Hyderabad', sites: 'Hebbal / Yelahanka' },
  ],
  hyderabad: [
    { nh: 'NH65', corridor: 'Hyderabad–Pune', sites: 'Gachibowli / Outer Ring' },
    { nh: 'NH44', corridor: 'Hyderabad–Bengaluru', sites: 'Shamshabad approaches' },
  ],
  chennai: [
    { nh: 'NH16', corridor: 'Chennai–Kolkata coastal', sites: 'Madhavaram / Ennore' },
    { nh: 'NH32', corridor: 'GST Road', sites: 'Guindy / Tambaram' },
  ],
  pune: [
    { nh: 'NH48', corridor: 'Pune–Mumbai', sites: 'Hinjewadi / Wakad exits' },
  ],
  kolkata: [
    { nh: 'NH16', corridor: 'Kolkata–Chennai', sites: 'Kona Expressway / Santragachi' },
  ],
  ahmedabad: [
    { nh: 'NH48', corridor: 'Ahmedabad–Vadodara', sites: 'SG Highway / Naroda' },
  ],
};

function loadZepto(): ZeptoStore[] {
  const file = path.resolve(__dirname, '../data/zepto-dark-stores.json');
  const raw = fs.readFileSync(file, 'utf8');
  return JSON.parse(raw) as ZeptoStore[];
}

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Deterministic Geo agent.
 * Uses PostGIS ST_ClusterDBSCAN when DATABASE_URL is available;
 * otherwise in-memory proximity clustering + OSM highway lookup tables
 * + mock Zepto dark-store overlap.
 */
export class GeoAgent implements Agent<GeoResult> {
  name = 'Geo' as const;

  async run(brandName: string, context: AgentContext): Promise<GeoResult> {
    const cities = context.footprint?.storesByCity.value ?? [];
    if (!cities.length) {
      // Footprint empty → seed one estimated market from Discovery HQ so
      // downstream planners have a legitimate anchor to select from, instead
      // of inventing metros. If HQ is unknown too, markets stays [] and the
      // brief fails honestly (never LLM-fabricated).
      const seeded = this.hqSeedMarkets(context);
      const result: GeoResult = {
        markets: seeded,
        partial: true,
        error: seeded.length
          ? 'No footprint cities — seeded estimated market from HQ'
          : 'No footprint cities and no resolvable HQ',
      };
      logAgentRaw(this.name, brandName, result);
      return result;
    }

    const zepto = loadZepto();
    let markets: GeoMarket[];

    if (process.env.DATABASE_URL) {
      try {
        markets = await this.withPostgis(cities, zepto);
      } catch (err) {
        logWarn('PostGIS geo path failed; using in-memory fallback', err);
        markets = this.inMemory(cities, zepto);
      }
    } else {
      markets = this.inMemory(cities, zepto);
    }

    const result: GeoResult = { markets };
    logAgentRaw(this.name, brandName, result);
    return result;
  }

  private inMemory(cities: StoreCity[], zepto: ZeptoStore[]): GeoMarket[] {
    return this.buildMarkets(cities, zepto);
  }

  /** Estimated seed market from Discovery HQ when footprint is empty.
   *  Zero stores, flagged 'hq-fallback' so the provenance validator and UI
   *  present it as estimated — never as a verified market. Deterministic. */
  private hqSeedMarkets(context: AgentContext): GeoMarket[] {
    const hqRaw = context.discovery?.hq?.value;
    if (!hqRaw || typeof hqRaw !== 'string') return [];
    // HQ strings look like "Kolkata, India" / "Gurugram, Haryana, India".
    const cityPart = hqRaw.split(',')[0]?.trim().toLowerCase() ?? '';
    if (!cityPart) return [];
    const key = CITY_COORDS[cityPart] ? cityPart : cityPart.replace(/\s+/g, '');
    if (!CITY_COORDS[key]) return []; // unknown city → no fabricated coords
    const displayName = cityPart.replace(/\b\w/g, (c) => c.toUpperCase());
    const highways: GeoHighway[] = (HIGHWAY_LOOKUP[key] ?? []).map((h) => ({
      city: displayName,
      nh: h.nh,
      corridor: h.corridor,
      sites: h.sites,
    }));
    return [
      {
        name: displayName,
        storeCount: 0,
        clusters: [],
        highways,
        zeptoOverlap: 0,
        seed: 'hq-fallback',
      },
    ];
  }

  private buildMarkets(cities: StoreCity[], zepto: ZeptoStore[]): GeoMarket[] {
    // Cluster by city proximity to metro hubs (simple DBSCAN-like grouping)
    const points = cities.map((c) => {
      const coord =
        CITY_COORDS[c.city.toLowerCase()] ??
        CITY_COORDS[c.city.toLowerCase().replace(/\s+/g, '')];
      return { ...c, coord };
    });

    const markets: GeoMarket[] = points.map((p) => {
      const key = p.city.toLowerCase();
      const highways: GeoHighway[] = (HIGHWAY_LOOKUP[key] ?? []).map((h) => ({
        city: p.city,
        nh: h.nh,
        corridor: h.corridor,
        sites: h.sites,
      }));

      const zeptoInCity = zepto.filter(
        (z) => z.city.toLowerCase() === key || z.city.toLowerCase().includes(key),
      );
      let zeptoOverlap = zeptoInCity.length;
      if (p.coord) {
        zeptoOverlap = zepto.filter(
          (z) => haversineKm(p.coord!, z) <= 25,
        ).length;
      }

      return {
        name: p.city,
        storeCount: p.count,
        clusters: [
          {
            zone: `${p.city} core`,
            count: Math.max(1, Math.round(p.count * 0.55)),
            areas: p.addresses.slice(0, 5).length
              ? p.addresses.slice(0, 5)
              : [`${p.city} CBD`, `${p.city} suburbs`],
          },
          {
            zone: `${p.city} periphery`,
            count: Math.max(0, p.count - Math.round(p.count * 0.55)),
            areas: [`${p.city} outskirts`],
          },
        ].filter((c) => c.count > 0),
        highways,
        zeptoOverlap,
        seed: 'footprint' as const,
      };
    });

    return markets.sort((a, b) => b.storeCount - a.storeCount);
  }

  private async withPostgis(
    cities: StoreCity[],
    zepto: ZeptoStore[],
  ): Promise<GeoMarket[]> {
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
      await client.query(`
        CREATE TEMP TABLE IF NOT EXISTS atlas_stores (
          id serial PRIMARY KEY,
          city text,
          count int,
          geom geography(Point, 4326)
        ) ON COMMIT DROP
      `);

      for (const c of cities) {
        const coord = CITY_COORDS[c.city.toLowerCase()];
        if (!coord) continue;
        await client.query(
          `INSERT INTO atlas_stores (city, count, geom)
           VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography)`,
          [c.city, c.count, coord.lng, coord.lat],
        );
      }

      const clustered = await client.query(`
        SELECT city, count, ST_ClusterDBSCAN(geom::geometry, eps := 0.5, minpoints := 1) OVER () AS cid
        FROM atlas_stores
      `);

      // Highway table may not exist — degrade gracefully
      let highwaysByCity = new Map<string, GeoHighway[]>();
      try {
        const hw = await client.query(`
          SELECT s.city, h.ref AS nh, h.name AS corridor
          FROM atlas_stores s
          JOIN osm_highways h
            ON ST_DWithin(s.geom, h.geom, 5000)
          LIMIT 50
        `);
        for (const row of hw.rows) {
          const list = highwaysByCity.get(row.city) ?? [];
          list.push({
            city: row.city,
            nh: row.nh ?? 'NH',
            corridor: row.corridor ?? 'OSM corridor',
            sites: 'Within 5km of store cluster',
          });
          highwaysByCity.set(row.city, list);
        }
      } catch {
        highwaysByCity = new Map();
      }

      return this.inMemory(cities, zepto).map((m) => ({
        ...m,
        highways:
          highwaysByCity.get(m.name)?.length
            ? highwaysByCity.get(m.name)!
            : m.highways,
        clusters: clustered.rows
          .filter((r) => r.city === m.name)
          .map((r) => ({
            zone: `cluster-${r.cid ?? 0}`,
            count: Number(r.count),
            areas: [r.city],
          })),
      }));
    } finally {
      await client.end();
    }
  }
}
