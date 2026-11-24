import fs from 'node:fs';
import path from 'node:path';
import { q, me as getMe, num, compact } from '../../lib/db';
import { PageHead, Card, Tag, Icon, Empty, Avatar } from '../ui';

const PROBES = [
  ['Creatives', 'select count(*)::int n from creatives'],
  ['Ad-day rows (spend)', 'select count(*)::int n, coalesce(sum(spend),0) s from ad_daily'],
  ['Account totals', 'select count(*)::int n from account_daily'],
  ['Shopify revenue', 'select count(*)::int n from shopify_daily'],
  ['Data-check amounts', 'select count(*)::int n from data_checks'],
  ['Data-check pass/fail', 'select count(*)::int n from check_status()'],
  ['Launch requests', 'select count(*)::int n from launch_requests'],
  ['Audit log', 'select count(*)::int n from audit_log'],
];
const AS = [['u-mgr-ana', 'Ana', 'manager'], ['u-st-priya', 'Priya', 'strategist'], ['u-ed-leo', 'Leo', 'editor'], ['', 'Not signed in', 'anon']];

const CREDS = [
  ['Meta token, ads_read', 'Nightly sync', 'Reads insights. Can’t create or change anything (tested: a create call with it fails).'],
  ['Meta token, ads_management', 'Launcher job only', 'Creates ad sets and ads, always PAUSED. No other process loads it.'],
  ['Shopify token, read_orders', 'Nightly sync', 'Orders only. No customers, no writes.'],
  ['Google service account', 'Nightly sync', 'Read-only scope, shared on the one tracker sheet.'],
  ['Database service role', 'Sync and launcher jobs', 'Writes data. Never sent to the browser.'],
  ['User session (JWT)', 'Portal', 'Every portal query runs as this user, under the RLS policies.'],
];

function tests() {
  try {
    const src = fs.readFileSync(path.resolve(process.cwd(), '..', 'tests', 'all.test.js'), 'utf8');
    return [...src.matchAll(/^test\('([^']+)'/gm)].map((m) => m[1]);
  } catch { return []; }
}

export default async function Page() {
  const me = await getMe();
  if (!me) return <Empty>No signed-in user.</Empty>;
  // Running a probe as someone else is a manager's view. Everyone else gets their own
  // column and the anonymous one, so a strategist can't read the manager column's totals.
  const cols = me.role === 'manager' ? AS : [[me.id, me.person, me.role], AS[3]];
  const matrix = [];
  for (const [label, sql] of PROBES) {
    const cells = [];
    for (const [uid] of cols) {
      try { const [r] = await q(sql, [], { as: uid }); cells.push(r); } catch (e) { cells.push({ denied: e.message }); }
    }
    matrix.push([label, cells]);
  }
  const [run] = await q('select * from sync_runs order by id desc limit 1');
  const list = tests();
  const groups = ['data', 'access', 'money'].map((g) => [g, list.filter((t) => t.startsWith(g + ':')).map((t) => t.slice(g.length + 2))]);

  return (
    <>
      <PageHead title="Access & controls" sub="Who can read what, which credential does what, and the tests that keep it that way" />

      <Card title="What each role gets back from the database" sub="Not a hard-coded table: each cell below was just queried as that user, through the same API and RLS policies as every other page" pad={false}>
        <div className="scroll"><table className="matrix">
          <thead><tr><th>Data</th>{cols.map(([id, name, role]) => <th key={role}><span className="who" style={{ justifyContent: 'center' }}>{id && <Avatar name={name} />}{name}</span><div className="muted" style={{ fontWeight: 400 }}>{role}</div></th>)}</tr></thead>
          <tbody>{matrix.map(([label, cells]) => (
            <tr key={label}><td><b>{label}</b></td>{cells.map((c, i) => (
              <td key={i}>{c.denied ? <span className="denied" title={c.denied}><Icon name="lock" size={12} />denied</span>
                : c.n === 0 ? <span className="zero">0 rows</span>
                : <span className="cellv">{num(c.n)}{c.s != null && <span className="muted" style={{ fontWeight: 400 }}> · {compact(c.s)}</span>}</span>}</td>))}</tr>))}
          </tbody>
        </table></div>
        <div className="card-b"><p className="note">{me.role !== 'manager' && <>You see your own column and the anonymous one; managers see every role side by side. </>}Priya sees only the creatives the tracker sheet credits to her, Leo only the ones he cut. Account totals, Shopify revenue and check amounts are manager-only. Without a session the database denies every table. The portal page never filters any of this itself.</p></div>
      </Card>

      <div className="grid">
        <Card title="Credentials, split by job" sub="Kept in environment variables, never in source (a test greps for them)" pad={false}>
          <div className="scroll"><table>
            <thead><tr><th>Credential</th><th className="l">Used by</th><th className="l">What it can do</th></tr></thead>
            <tbody>{CREDS.map(([c, who, what]) => (
              <tr key={c}><td><span className="who"><Icon name="key" size={14} />{c}</span></td><td className="l">{who}</td><td className="l wrap" style={{ minWidth: 200 }}>{what}</td></tr>))}</tbody>
          </table></div>
        </Card>
        <Card title="Last sync" sub="Nightly job: Meta (ad + account level), tracker sheet, Shopify → Postgres">
          <div className="kpis k4">
            <div className="kpi"><div className="kpi-l">Run</div><div className="kpi-v">#{run.id} <Tag tone={run.status === 'ok' ? 'pass' : 'warn'}>{run.status}</Tag></div><div className="kpi-f">{run.finished_at ? run.finished_at.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : ''}</div></div>
            <div className="kpi"><div className="kpi-l">Meta calls</div><div className="kpi-v">{run.meta_calls}</div><div className="kpi-f">{run.meta_throttles} throttles retried with backoff</div></div>
            <div className="kpi"><div className="kpi-l">Shopify calls</div><div className="kpi-v">{run.shopify_calls}</div><div className="kpi-f">{run.shopify_429} × 429 retried, cursor paging</div></div>
            <div className="kpi"><div className="kpi-l">Write path</div><div className="kpi-v" style={{ fontSize: 16 }}>Upsert by (date, ad)</div><div className="kpi-f">re-pulling a day replaces it, never doubles it</div></div>
          </div>
        </Card>
      </div>

      <Card title={`Tests (${list.length})`} sub="node --test tests/all.test.js · runs against the mock APIs">
        <div className="grid g3">{groups.map(([g, ts]) => (
          <div key={g}>
            <h3 style={{ textTransform: 'capitalize' }}>{g} <span className="muted">({ts.length})</span></h3>
            <ul className="fixlist">{ts.map((t) => <li key={t}><Icon name="check" /><span>{t}</span></li>)}</ul>
          </div>))}
        </div>
      </Card>

      <Card title="Not done yet" sub="Kept here on purpose, so nobody relies on something that isn’t built">
        <ul className="fixlist">
          <li><Icon name="info" /><span><b>Real accounts.</b> Everything runs against mocks of Meta, Sheets and Shopify that page, throttle and send duplicate purchase fields like the real APIs. Going live is tokens and config, then one reconciliation by hand against Ads Manager and a Shopify report before anyone relies on it.</span></li>
          <li><Icon name="info" /><span><b>Supabase Auth login.</b> The demo switches users from the “Viewing as” menu. The queries already run as that user under RLS, so login replaces the menu and nothing else.</span></li>
          <li><Icon name="info" /><span><b>Nightly re-pull of the last 7 days</b> so late-attributed conversions update. The upsert is in place; the schedule isn’t.</span></li>
          <li><Icon name="info" /><span><b>Alerting.</b> A held-back day or a sheet gap should post to Slack, not wait for someone to open this page.</span></li>
        </ul>
      </Card>
    </>
  );
}
