import { q, me as getMe, money, iso } from '../../lib/db';
import { PageHead, Card, Tag, Icon, Empty, Avatar } from '../ui';
import { requestTest, reviewTest } from './actions';

const LIMIT = { perTest: 500, perDay: 3000 };
const TONE = { created: 'pass', pending: 'warn', approved: 'info', rejected: 'fail', failed: 'fail' };
const LABEL = { created: 'Created · PAUSED', pending: 'Waiting for a manager', approved: 'Approved', rejected: 'Rejected', failed: 'Failed' };

function Steps({ r }) {
  const held = r.status === 'approved' && r.error;
  const s = [
    'done',
    r.status === 'pending' ? 'wait' : r.status === 'rejected' ? 'stop' : 'done',
    r.status === 'created' ? 'done' : r.status === 'failed' || held ? 'stop' : '',
    '',
  ];
  return <span className="steps" title="Requested → approved by a second manager → created PAUSED → turned on by a person in Ads Manager">{s.map((c, i) => <i key={i} className={c} />)}</span>;
}

export default async function Page({ searchParams }) {
  const sp = await searchParams;
  const me = await getMe();
  if (!me) return <Empty>No signed-in user.</Empty>;
  const isMgr = me.role === 'manager';
  const rows = await q(`select l.*, a.person requester, a.role requester_role, r.person reviewer from launch_requests l
    left join app_users a on a.id = l.requested_by left join app_users r on r.id = l.reviewed_by order by l.id desc`);
  const [day] = await q(`select created_at::date d, sum(daily_budget_cents)::int c, count(*)::int n from launch_requests where status = 'created' group by 1 order by 1 desc limit 1`);
  const audit = isMgr ? await q('select * from audit_log order by id desc limit 8') : [];
  const held = rows.filter((r) => r.error?.startsWith('held')).length;
  const created = rows.filter((r) => r.status === 'created').length;
  const committed = (day?.c || 0) / 100, heldBudget = rows.filter((r) => r.error?.startsWith('held')).reduce((s, r) => s + r.daily_budget_cents / 100, 0);
  const nextCode = 530 + rows.length;

  const guards = [
    ['pause', 'Created PAUSED, always', `${created} of ${created} created ads are paused. Turning one on is a person’s click in Ads Manager.`],
    ['users', 'A second manager approves', 'Enforced by an RLS policy: the reviewer must be a manager and not the requester.'],
    ['shield', `$${LIMIT.perTest}/day per test`, 'A check constraint in the table and a check in the launcher. Reviewers can’t edit the budget.'],
    ['db', `$${num(LIMIT.perDay)}/day of new tests`, `Anything past the daily total is held, not created. ${held} held right now.`],
    ['refresh', 'Retries never duplicate', 'Idempotency key per request; the ad set id is saved before the ad is made, so a retry after Meta throttling (#80004) reuses it.'],
    ['key', 'Kill switch, dry run by default', 'LAUNCH_KILL_SWITCH stops every publish. Only the launcher job holds the ads_management token.'],
  ];

  return (
    <>
      <PageHead title="Launch queue" sub="Strategists request a test, a second manager approves, the launcher creates it in Meta PAUSED" />
      {sp?.ok && <div className="banner ok"><Icon name="check" /><div>{sp.ok}</div></div>}
      {sp?.err && <div className="banner bad"><Icon name="lock" /><div><b>{/row-level security|violates/.test(sp.err) ? 'Refused by the database (row-level security).' : 'Refused.'}</b> <span className="mono">{sp.err}</span></div></div>}

      <div className="grid g3">{guards.map(([icon, t, d]) => (
        <div className="guard" key={t}><span className="gi"><Icon name={icon} /></span><div><b>{t}</b><span>{d}</span></div></div>))}
      </div>

      <div className="grid g2">
        {isMgr && (
          <Card title="New-test budget, last launcher run" sub={day ? `${iso(day.d)} · cap $${num(LIMIT.perDay)}/day` : 'No launches yet'}>
            <div className="kpi-v">{money(committed)} <span className="muted" style={{ fontSize: 14, fontWeight: 500 }}>of {money(LIMIT.perDay)}</span></div>
            <div className="cap" style={{ marginTop: 10 }}>
              <span style={{ width: `${(100 * committed) / LIMIT.perDay}%`, background: 'var(--ok-fill)' }} />
            </div>
            <ul className="seg-legend">
              <li><span className="sw pass" />Created, PAUSED<b>{money(committed)}</b><small>{day?.n || 0}</small></li>
              <li><span className="sw fail" />Held by the daily cap<b>{money(heldBudget)}</b><small>{held}</small></li>
            </ul>
          </Card>
        )}
        <Card title="Request a test" sub={me.role === 'editor' ? 'Editors can’t request launches' : `As ${me.person}. A different manager has to approve it.`} className={isMgr ? '' : 'span2'}>
          <form action={requestTest} className="form">
            <label>Ad name (tracker convention)<input type="text" name="adName" defaultValue={`FL_261124_CoolTouch_UGC_POV_ST-${me.person}_ED-Leo_C${nextCode}`} disabled={me.role === 'editor'} /></label>
            <label>Daily budget ($, cap {LIMIT.perTest})<input type="number" name="budget" defaultValue="250" min="1" step="1" disabled={me.role === 'editor'} /></label>
            <button className="btn primary" disabled={me.role === 'editor'}><Icon name="rocket" size={14} />Request</button>
          </form>
          <p className="note" style={{ marginTop: 10 }}>Try a budget over $500 or approving your own request: the refusal comes from the database, not this page.</p>
        </Card>
      </div>

      <Card title="Requests" sub={isMgr ? 'Everyone’s requests' : 'Only your own requests are visible to you'} pad={false}>
        {rows.length ? (
          <div className="scroll"><table>
            <thead><tr><th>#</th><th className="l">Ad name</th><th className="l">Requested by</th><th>Daily budget</th><th className="l">Progress</th><th className="l">Status</th><th className="l">Reviewed by</th><th className="l">Meta ad</th>{isMgr && <th className="l">Review</th>}</tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td>{r.id}</td>
                <td className="l mono" style={{ whiteSpace: 'normal', wordBreak: 'break-all', minWidth: 220, maxWidth: 300, fontSize: 11.5 }}>{r.ad_name}</td>
                <td className="l"><span className="who"><Avatar name={r.requester} />{r.requester}</span></td>
                <td>{money(r.daily_budget_cents / 100)}</td>
                <td className="l"><Steps r={r} /></td>
                <td className="l"><Tag tone={r.error ? 'warn' : TONE[r.status]}>{r.error ? 'Held: over daily cap' : LABEL[r.status]}</Tag></td>
                <td className="l">{r.reviewer || <span className="muted">—</span>}</td>
                <td className="l mono" style={{ fontSize: 11.5 }}>{r.meta_ad_id || <span className="muted">—</span>}</td>
                {isMgr && <td className="l">{r.status === 'pending' ? (
                  <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                    <form action={reviewTest} className="inline"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approved" /><button className="btn sm ok"><Icon name="check" size={12} />Approve</button></form>
                    <form action={reviewTest} className="inline"><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="rejected" /><button className="btn sm bad"><Icon name="x" size={12} />Reject</button></form>
                    {r.requested_by === me.id && <span className="muted" style={{ fontSize: 12 }}>your own</span>}
                  </span>) : <span className="muted">—</span>}</td>}
              </tr>))}
            </tbody>
          </table></div>
        ) : <div className="card-b"><Empty>{me.role === 'editor' ? 'Editors can’t see or request launches. Row-level security returns no rows.' : 'No requests visible to you yet.'}</Empty></div>}
      </Card>

      {isMgr && (
        <Card title="Audit log" sub="Written by the launcher job for every ad it creates" pad={false}>
          <div className="scroll"><table>
            <thead><tr><th>When</th><th className="l">Actor</th><th className="l">Action</th><th className="l">Detail</th></tr></thead>
            <tbody>{audit.map((a) => (
              <tr key={a.id}><td>{a.at.toISOString().replace('T', ' ').slice(0, 19)}</td><td className="l">{a.actor}</td><td className="l"><Tag tone="pass">{a.action}</Tag></td>
                <td className="l mono">request #{a.detail.request} · ad set {a.detail.adset} · ad {a.detail.ad} · {money(a.detail.budget_cents / 100)}/day</td></tr>))}</tbody>
          </table></div>
        </Card>
      )}
    </>
  );
}

const num = (x) => Number(x).toLocaleString('en-US');
