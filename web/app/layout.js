import './globals.css';
import { users, currentUid, q } from '../lib/db';
import { NavLink, Switcher, ThemeToggle } from './chrome';
import { Icon } from './ui';

export const metadata = { title: 'Fernlow · Creative Performance', description: 'Creative performance, data checks and guarded launches' };
export const dynamic = 'force-dynamic';

const NAV = [
  ['Performance', [['/', 'grid', 'Overview'], ['/creatives', 'film', 'Creatives'], ['/insights', 'bulb', 'Insights']]],
  ['Trust', [['/checks', 'shield', 'Data checks'], ['/controls', 'lock', 'Access & controls']]],
  ['Operations', [['/launches', 'rocket', 'Launch queue'], ['/video', 'video', 'Video variants']]],
];

// Sets the saved theme before first paint so there is no flash.
const THEME = `try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default async function Layout({ children }) {
  const [list, uid] = [await users(), await currentUid()];
  const meRow = list.find((u) => u.id === uid);
  let status = null;
  try {
    const [s] = await q(`select count(*) filter (where status = 'pass')::int ok, count(*)::int n from check_status() where check_name = 'meta_spend_matches_account'`);
    const [r] = await q('select id, finished_at from sync_runs order by id desc limit 1');
    status = { ...s, run: r };
  } catch { /* data API down: the page itself will say so */ }
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME }} /></head>
      <body>
        <div className="shell">
          <aside className="side">
            <div className="brand">
              <span className="logo"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg></span>
              <div><b>Fernlow</b><small>Creative Ops</small></div>
            </div>
            <nav>
              {NAV.map(([group, items]) => (
                <div key={group} className="navgroup">
                  <span>{group}</span>
                  {items.map(([href, icon, label]) => <NavLink key={href} href={href}><Icon name={icon} />{label}</NavLink>)}
                </div>
              ))}
            </nav>
            <div className="side-foot">
              <div><Icon name="meta" size={13} />Meta Marketing API</div>
              <div><Icon name="sheet" size={13} />Creative tracker sheet</div>
              <div><Icon name="store" size={13} />Shopify Admin API</div>
              <p>Demo brand and synthetic data, served by local mocks of each API.</p>
            </div>
          </aside>
          <div className="main">
            <header className="top">
              {status && (
                <a href="/checks" className={`pill ${status.ok === status.n ? 'ok' : 'bad'}`}>
                  <span className="dot" />{status.ok}/{status.n} days reconciled with Meta
                  <span className="pill-sub">sync #{status.run?.id}</span>
                </a>
              )}
              <div className="top-r">
                {meRow && <span className={`role ${meRow.role}`}>{meRow.role}</span>}
                <Switcher users={list} uid={uid} />
                <ThemeToggle />
              </div>
            </header>
            <main>{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
