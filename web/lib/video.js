import fs from 'node:fs';
import path from 'node:path';

// Output of video/hookswap.js. Files live outside the database, so access is checked here
// with the same rule RLS uses for creatives: managers see all, strategists and editors only
// the variants their name is on. (In production these sit in Supabase Storage behind a
// storage policy with the same rule.)
export const VIDEO_DIR = path.resolve(process.cwd(), '..', 'out', 'video');

export function report() {
  try { return JSON.parse(fs.readFileSync(path.join(VIDEO_DIR, 'qa_report.json'), 'utf8')); } catch { return []; }
}

export const owns = (me, name) => !!me && (me.role === 'manager' || name.includes(`_ST-${me.person}_`) || name.includes(`_ED-${me.person}_`));

export function visibleVariants(me) {
  return report().filter((v) => owns(me, v.name));
}

export function canRead(me, file) {
  if (!/^[A-Za-z0-9_.-]+\.(mp4|jpg)$/.test(file)) return false;
  const m = file.match(/^(FL_.+_C\d+)_(9x16|4x5|thumb)\.(mp4|jpg)$/);
  if (m) return owns(me, m[1]);
  // contact sheets and source clips: anyone who can see at least one variant
  return ['hooks_contact_sheet.jpg', 'pov_9x16_vs_4x5.jpg'].includes(file) && visibleVariants(me).length > 0;
}
