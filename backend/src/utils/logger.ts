import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, '../../logs');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

export function logAgentRaw(agent: string, brand: string, payload: unknown) {
  ensureLogDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeBrand = brand.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40);
  const file = path.join(LOG_DIR, `${stamp}_${agent}_${safeBrand}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify(
      { agent, brand, at: new Date().toISOString(), payload },
      null,
      2,
    ),
    'utf8',
  );
  return file;
}

export function logInfo(message: string, extra?: unknown) {
  if (extra !== undefined) {
    console.log(`[atlas] ${message}`, extra);
  } else {
    console.log(`[atlas] ${message}`);
  }
}

export function logWarn(message: string, extra?: unknown) {
  if (extra !== undefined) {
    console.warn(`[atlas] ${message}`, extra);
  } else {
    console.warn(`[atlas] ${message}`);
  }
}
