// Small presentational pieces shared by every page. Server components, no state.

const PATHS = {
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4',
  bulb: 'M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V18h6v-1.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z',
  shield: 'M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5z',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18M6 6l12 12',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  info: 'M12 16v-4M12 8h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z',
  rocket: 'M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 11a14 14 0 0 1 11-8 14 14 0 0 1-8 11l-3 1-1-1zM9 11l-4-1 3-3h4M13 15l1 4 3-3v-4',
  video: 'M15 10l5-3v10l-5-3zM3 6h12v12H3z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  key: 'M15 7a4 4 0 1 1-3.9 5H3v3h3v3h3v-3h2.1A4 4 0 0 1 15 7z',
  refresh: 'M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M3 21v-5h5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  back: 'M19 12H5M11 18l-6-6 6-6',
  store: 'M3 9l2-5h14l2 5M3 9v11h18V9M3 9h18M9 20v-6h6v6',
  sheet: 'M5 3h10l4 4v14H5zM9 12h6M9 16h6M9 8h2',
  meta: 'M2 15c0-4 2-8 5-8 4 0 6 10 10 10 2 0 3-2 3-5s-1-5-3-5c-4 0-6 10-10 10-2 0-5-2-5-2',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
};
export function Icon({ name, size = 16, className = '' }) {
  return (
    <svg className={`ico ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name]} /></svg>
  );
}

const TONE_ICON = { pass: 'check', fail: 'x', warn: 'alert', info: 'info' };
export function Tag({ tone = 'info', children, icon = true }) {
  return <span className={`tag ${tone}`}>{icon && <Icon name={TONE_ICON[tone] || 'info'} size={12} />}{children}</span>;
}

export function PageHead({ title, sub, children }) {
  return (
    <div className="pagehead">
      <div><h1>{title}</h1>{sub && <p className="sub">{sub}</p>}</div>
      {children && <div className="pagehead-r">{children}</div>}
    </div>
  );
}

export function Card({ title, sub, right, children, className = '', pad = true }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && <div className="card-h"><div>{title && <h2>{title}</h2>}{sub && <p className="sub">{sub}</p>}</div>{right}</div>}
      <div className={pad ? 'card-b' : ''}>{children}</div>
    </section>
  );
}

// Stat tile: label, value, optional delta vs a named period, optional sparkline.
export function Kpi({ label, value, foot, delta, spark, goodUp = true, icon }) {
  let d = null;
  if (delta != null && Number.isFinite(delta)) {
    const up = delta >= 0, tone = goodUp === null ? 'neutral' : up === goodUp ? 'good' : 'bad';
    d = <span className={`delta ${tone}`}>{up ? '▲' : '▼'} {Math.abs(delta * 100).toFixed(1)}%</span>;
  }
  return (
    <div className="kpi">
      <div className="kpi-l">{icon && <Icon name={icon} size={14} />}{label}</div>
      <div className="kpi-vr"><div className="kpi-v">{value}</div>{spark && <Spark values={spark} w={96} />}</div>
      <div className="kpi-f">{d}{d && foot ? ' ' : ''}{foot && <span>{foot}</span>}</div>
    </div>
  );
}

export function Spark({ values, w = 120, h = 28 }) {
  const v = values.map(Number), max = Math.max(...v), min = Math.min(...v), span = max - min || 1;
  const pts = v.map((y, i) => [(i / (v.length - 1 || 1)) * (w - 4) + 2, h - 3 - ((y - min) / span) * (h - 6)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden="true">
      <path d={d} fill="none" stroke="var(--spark)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill="var(--series-1)" />
    </svg>
  );
}

export function Avatar({ name, role }) {
  const hue = [...String(name)].reduce((s, c) => s + c.charCodeAt(0), 0) % 360;
  return <span className={`av ${role || ''}`} style={{ '--h': hue }}>{String(name || '?').slice(0, 1)}</span>;
}

// In-cell bar: value relative to a max, with an optional marker (e.g. the winner line).
export function Meter({ value, max, mark, tone = 'acc' }) {
  const p = Math.max(0, Math.min(1, Number(value) / (Number(max) || 1)));
  const m = mark != null ? Math.min(1, mark / (Number(max) || 1)) : null;
  return (
    <span className={`meter ${tone}`}><span className="fill" style={{ width: `${p * 100}%` }} />
      {m != null && <span className="mark" style={{ left: `${m * 100}%` }} />}</span>
  );
}

// One whole split into parts, with a legend that carries the counts.
export function Segmented({ parts }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div>
      <div className="seg">{parts.filter((p) => p.value > 0).map((p) => (
        <span key={p.label} className={`seg-p ${p.tone}`} style={{ flexGrow: p.value }} title={`${p.label}: ${p.display ?? p.value}`} />))}
      </div>
      <ul className="seg-legend">{parts.map((p) => (
        <li key={p.label}><span className={`sw ${p.tone}`} />{p.label}<b>{p.display ?? p.value}</b><small>{((100 * p.value) / total).toFixed(0)}%</small></li>))}
      </ul>
    </div>
  );
}

export function Empty({ children, icon = 'lock' }) {
  return <div className="empty"><Icon name={icon} size={18} /><div>{children}</div></div>;
}
