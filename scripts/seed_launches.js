// Puts a realistic launch queue into the portal DB, going through the same guarded path.
import { openDb } from '../lib/db.js';
import { loadEnv } from '../lib/env.js';
import { requestLaunch, review, publishApproved } from '../launch/launcher.js';
loadEnv();
const db = await openDb();
const reqs = [
  ['u-st-priya', 'FL_261122_CoolTouch_UGC_POV_ST-Priya_ED-Leo_C516', 45000, 'u-mgr-ana', 'approved'],
  ['u-st-sam', 'FL_261122_HotelBed_Founder_Stat_ST-Sam_ED-Mei_C517', 40000, 'u-mgr-ana', 'approved'],
  ['u-st-marco', 'FL_261122_Reviews_Static_Callout_ST-Marco_ED-Ines_C518', 30000, 'u-mgr-joel', 'approved'],
  ['u-st-dana', 'FL_261122_BackPain_Demo_Problem_ST-Dana_ED-Kofi_C519', 50000, 'u-mgr-joel', 'approved'],
  ['u-st-priya', 'FL_261122_PartnerSnore_UGC_Q_ST-Priya_ED-Ruth_C520', 50000, 'u-mgr-joel', 'approved'],
  ['u-st-sam', 'FL_261122_SleepScore_Carousel_Stat_ST-Sam_ED-Leo_C521', 50000, 'u-mgr-ana', 'approved'],
  ['u-st-marco', 'FL_261122_Unboxing_UGC_POV_ST-Marco_ED-Mei_C522', 45000, 'u-mgr-ana', 'approved'],
  ['u-st-dana', 'FL_261122_CoolTouch_Static_Before-After_ST-Dana_ED-Ines_C523', 25000, 'u-mgr-ana', 'rejected'],
  ['u-mgr-ana', 'FL_261122_HotelBed_UGC_Callout_ST-Ana_ED-Leo_C524', 20000, null, 'pending'],
];
for (const [i, [uid, name, cents, reviewer, decision]] of reqs.entries()) {
  const { id } = await requestLaunch(db, uid, { idempotencyKey: `seed-${i}`, adName: name, campaignId: 'cmp_testing', creativeId: `cr_${516 + i}`, dailyBudgetCents: cents });
  if (reviewer) await review(db, reviewer, id, decision);
}
console.log(JSON.stringify(await publishApproved(db, { dryRun: false }), null, 1));
await db.close();
