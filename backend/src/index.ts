import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import cors from 'cors';
import express from 'express';
import { runResearchOrchestrator } from './orchestrator.js';
import {
  getActiveProvider,
  getGeminiApiKey,
  getOpenRouterApiKey,
  hasAnyLlmProvider,
  probeGemini,
  probeOpenRouter,
} from './utils/llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json());

app.get('/health', async (_req, res) => {
  const [openrouter, gemini] = await Promise.all([
    probeOpenRouter(),
    probeGemini(),
  ]);

  res.json({
    status: 'ok',
    service: 'atlas-backend',
    gemini: gemini.configured,
    openrouter: openrouter.configured,
    openrouter_ok: openrouter.ok,
    openrouter_error: openrouter.error ?? null,
    gemini_ok: gemini.ok,
    active_provider: getActiveProvider(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api', (_req, res) => {
  res.json({
    name: 'Atlas API',
    version: '0.1.0',
    message: 'Stage 4 — multi-provider LLM orchestrator (OpenRouter + Gemini)',
  });
});

app.get('/api/research/stream', async (req, res) => {
  const brand = String(req.query.brand ?? '').trim();
  if (!brand) {
    res.status(400).json({ error: 'Missing required query param: brand' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const controller = new AbortController();
  req.on('close', () => {
    controller.abort();
  });

  try {
    await runResearchOrchestrator(brand, res, controller.signal);
  } catch (err) {
    if (!controller.signal.aborted) {
      const message = err instanceof Error ? err.message : 'Stream failed';
      res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
    }
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
  }
});

app.listen(PORT, async () => {
  console.log(`Atlas backend listening on http://localhost:${PORT}`);
  console.log(
    `OpenRouter key: ${getOpenRouterApiKey() ? 'present' : 'NO — set OPENROUTER_API_KEY'}`,
  );
  console.log(
    `Gemini key: ${getGeminiApiKey() ? 'present' : 'NO — set GEMINI_API_KEY'}`,
  );

  const or = await probeOpenRouter();
  if (or.configured) {
    console.log(
      `OpenRouter auth: ${or.ok ? 'OK' : `FAILED — ${or.error}`}`,
    );
  }
  console.log(`Active provider: ${getActiveProvider() ?? 'none'}`);

  if (!hasAnyLlmProvider()) {
    console.warn(
      '[atlas] No LLM keys configured. Add OPENROUTER_API_KEY and/or GEMINI_API_KEY to .env',
    );
  }
});
