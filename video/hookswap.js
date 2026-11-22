// Hook-swap pipeline: one body clip + N hook clips -> N ad variants in 9:16 and 4:5,
// captions burned in, named in the tracker's convention so the sheet join and the
// launcher pick them up. Then every output is checked (size, duration, audio) before
// anything goes to the launch queue.
// Source clips here are generated test footage; in real use they come from the editors' drive.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';

const OUT = path.resolve('out/video');
fs.mkdirSync(OUT, { recursive: true });
const FONT = 'C\\:/Windows/Fonts/arialbd.ttf';
const run = (args) => {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r;
};
const esc = (t) => t.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, '\u2019');
const text = (t, y, size = 64) => `drawtext=fontfile='${FONT}':text='${esc(t)}':fontcolor=white:fontsize=${size}:borderw=4:bordercolor=black@0.8:x=(w-text_w)/2:y=${y}`;

// 1. stand-in source footage (1080x1920, 30fps, with a tone so audio exists)
const src = (name, color, secs, label) => {
  const f = path.join(OUT, `src_${name}.mp4`);
  run(['-f', 'lavfi', '-i', `color=c=${color}:s=1080x1920:r=30:d=${secs}`, '-f', 'lavfi', '-i', `sine=frequency=330:duration=${secs}`,
    '-vf', text(label, '(h-text_h)/2', 54), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', f]);
  return f;
};
const body = src('body', '0x2b3a55', 6, 'BODY: product demo + offer');
const hooks = [
  { id: 'Q', clip: src('hook_q', '0x7a3e2b', 2, 'HOOK A'), caption: 'Why do you wake up at 3am?' },
  { id: 'Stat', clip: src('hook_stat', '0x2b6a4a', 2, 'HOOK B'), caption: '41,000 people switched this year' },
  { id: 'POV', clip: src('hook_pov', '0x5b2b6a', 2, 'HOOK C'), caption: 'POV: your partner stops stealing the duvet' },
];

// Captions sit at y>=380 so the centred 4:5 crop (which drops the top 285px) keeps them.
// Captions: wrap to 22 chars a line and refuse anything that won't fit the 960px safe zone.
// (First run had no wrap; QA passed a POV caption that ran off both edges. Caught on the contact sheet.)
const wrap = (t, n = 22) => t.split(' ').reduce((ls, w) => { const l = ls.at(-1); if (l && (l + ' ' + w).length <= n) ls[ls.length - 1] = l + ' ' + w; else ls.push(w); return ls; }, []);
const estWidth = (line, size) => line.length * size * 0.56; // Arial Bold average advance
const captionFilter = (t, size = 62) => {
  const lines = wrap(t);
  for (const l of lines) if (estWidth(l, size) > 960) throw new Error(`caption line too wide: "${l}"`);
  if (lines.length > 3) throw new Error(`caption too long: ${lines.length} lines`);
  return lines.map((l, i) => `${text(l, 380 + i * (size + 14), size)}:enable='lt(t,2)'`).join(',');
};

// 2. variants
const today = '261122';
let code = 610;
const made = [];
for (const h of hooks) {
  code++;
  const name = `FL_${today}_CoolTouch_UGC_${h.id}_ST-Priya_ED-Leo_C${code}`;
  const v916 = path.join(OUT, `${name}_9x16.mp4`);
  run(['-i', h.clip, '-i', body, '-filter_complex',
    `[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a];[v]${captionFilter(h.caption)},${text('Fernlow CoolTouch', 'h-360', 48)}[vo];[a]loudnorm=I=-14:TP=-1.5[ao]`,
    '-map', '[vo]', '-map', '[ao]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', v916]);
  const v45 = path.join(OUT, `${name}_4x5.mp4`);
  run(['-i', v916, '-vf', 'crop=1080:1350:0:(ih-1350)/2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-c:a', 'copy', v45]);
  const thumb = path.join(OUT, `${name}_thumb.jpg`);
  run(['-ss', '0.5', '-i', v916, '-frames:v', '1', '-vf', 'scale=360:-1', thumb]);
  made.push({ name, hook: h.id, files: [v916, v45], thumb, captionLines: wrap(h.caption) });
}

// 3. QA every output before it can be queued
const probe = (f) => {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-i', f], { encoding: 'utf8' });
  const s = r.stderr;
  const [, hh, mm, ss] = s.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const [, w, hgt] = s.match(/Video: .*?, (\d{3,4})x(\d{3,4})/);
  return { duration: +hh * 3600 + +mm * 60 + +ss, w: +w, h: +hgt, audio: /Audio: aac/.test(s), bytes: fs.statSync(f).size };
};
const report = made.map((m) => ({
  name: m.name, captionLines: m.captionLines, captionFits: m.captionLines.every((l) => estWidth(l, 62) <= 960),
  outputs: m.files.map((f) => {
    const p = probe(f);
    const want = f.endsWith('_9x16.mp4') ? [1080, 1920] : [1080, 1350];
    const ok = m.captionLines.every((l) => estWidth(l, 62) <= 960) && p.w === want[0] && p.h === want[1] && Math.abs(p.duration - 8) < 0.2 && p.audio && p.bytes < 30e6;
    return { file: path.basename(f), ...p, ok };
  }),
}));
// contact sheet of the three hooks
run([...made.flatMap((m) => ['-i', m.thumb]), '-filter_complex', `hstack=inputs=${made.length}`, path.join(OUT, 'hooks_contact_sheet.jpg')]);
fs.writeFileSync(path.join(OUT, 'qa_report.json'), JSON.stringify(report, null, 2));
const all = report.flatMap((r) => r.outputs);
console.log(`${all.filter((o) => o.ok).length}/${all.length} outputs passed QA`);
for (const o of all) console.log(o.ok ? 'ok  ' : 'FAIL', o.file, `${o.w}x${o.h}`, o.duration.toFixed(2) + 's', (o.bytes / 1e6).toFixed(1) + 'MB');
