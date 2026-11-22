import fs from 'node:fs';
// Tiny .env loader so secrets live outside the code. Real values never get committed.
export function loadEnv(file = '.env') {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=([^#\s]*)/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
// Redact anything token-like before it reaches a log line.
export const redact = (s) => String(s).replace(/(access_token=|token["':=\s]+)[^&"'\s]+/gi, '$1[redacted]');
