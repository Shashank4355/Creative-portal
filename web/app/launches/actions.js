'use server';
import { redirect } from 'next/navigation';
import { post } from '../../lib/db';

// Both actions only pass the user's intent to the data API. Who may request, who may
// approve, and how much, is decided by Postgres (RLS + check constraints) and the launcher.
const back = (r, okMsg) => {
  const p = r.ok ? `ok=${encodeURIComponent(okMsg)}` : `err=${encodeURIComponent(r.body.error || 'refused')}`;
  redirect(`/launches?${p}`);
};

export async function requestTest(form) {
  const r = await post('/launch/request', { adName: String(form.get('adName') || '').trim(), dailyBudget: form.get('budget') });
  back(r, r.body?.duplicate ? `Request #${r.body.id} already exists; nothing new was created.` : `Request #${r.body?.id} sent. A manager other than you has to approve it.`);
}

export async function reviewTest(form) {
  const id = form.get('id'), decision = form.get('decision');
  const r = await post('/launch/review', { id, decision });
  back(r, `Request #${id} ${decision}. The launcher job picks it up and creates it PAUSED.`);
}
