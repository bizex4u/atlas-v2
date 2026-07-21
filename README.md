# Atlas

AI-powered market intelligence platform for Bizex4U.

## Stack

- **Frontend:** React + TypeScript + Vite + Tailwind CSS + Framer Motion
- **Backend:** Node.js + Express + TypeScript
- **Shared:** CampaignBrief types (`@atlas/shared`)
- **Database:** PostgreSQL + PostGIS (Stage 4+)
- **LLM:** Gemini 2.0 Flash

## Monorepo

```
/frontend   Vite React app
/backend    Express API
/shared     Shared TypeScript types
```

## Setup

```bash
cp .env.example .env
npm install
npm run build:shared
```

## Develop

```bash
# Terminal 1 — API on :3001
npm run dev:backend

# Terminal 2 — UI on :5173
npm run dev:frontend
```

## Environment

| Variable | Description |
|---|---|
| `GEMINI_API_KEY` | Google Gemini API key |
| `DATABASE_URL` | PostgreSQL connection string |
| `NODE_ENV` | `development` / `production` |
| `PORT` | Backend port (default `3001`) |

## Stages

1. Project skeleton
2. Search screen
3. Agent overlay (SSE)
4. **Backend agent architecture** ← current
5. Confidence extraction protocol (utility live in Stage 4)
6. Campaign brief schema (types in `/shared`)
7. Brief screens
8. Confidence badges + edit mode
9. Caching

### Stage 4 — run real research

1. Set at least one LLM key in the root `.env`:
   - `OPENROUTER_API_KEY` (preferred) from https://openrouter.ai/keys
   - and/or `GEMINI_API_KEY`
2. Optional: `LLM_PROVIDER_ORDER=openrouter,gemini`
3. Restart backend: `npm run dev:backend`
4. Check `/health` — should show `openrouter: true` and `active_provider: "openrouter"`
5. Open http://localhost:5173, search **Bata India** or **Campus Shoes**
6. Backend logs show `[llm] provider=openrouter model=…` per call
7. Final `CampaignBrief` prints in the backend console and under `backend/logs/`

Optional: `DATABASE_URL` enables PostGIS clustering in GeoAgent (falls back to in-memory if unset).
