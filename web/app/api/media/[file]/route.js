import fs from 'node:fs';
import path from 'node:path';
import { me as getMe } from '../../../../lib/db';
import { VIDEO_DIR, canRead } from '../../../../lib/video';

// Streams a rendered variant, with Range support so the browser can seek.
export async function GET(req, { params }) {
  const { file } = await params;
  const me = await getMe().catch(() => null);
  if (!canRead(me, file)) return new Response('not found', { status: 404 });
  const p = path.join(VIDEO_DIR, file);
  if (!fs.existsSync(p)) return new Response('not found', { status: 404 });
  const size = fs.statSync(p).size;
  const type = file.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg';
  const range = req.headers.get('range')?.match(/bytes=(\d*)-(\d*)/);
  if (range && type === 'video/mp4') {
    const start = range[1] ? Number(range[1]) : 0, end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    return new Response(fs.readFileSync(p).subarray(start, end + 1), {
      status: 206, headers: { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': String(end - start + 1), 'cache-control': 'private, no-store' },
    });
  }
  return new Response(fs.readFileSync(p), { headers: { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': String(size), 'cache-control': 'private, no-store' } });
}
