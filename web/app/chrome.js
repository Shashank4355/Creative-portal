'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export function NavLink({ href, children }) {
  const path = usePathname();
  const active = href === '/' ? path === '/' : path.startsWith(href);
  return <Link href={href} className={active ? 'on' : ''} aria-current={active ? 'page' : undefined}>{children}</Link>;
}

export function Switcher({ users, uid }) {
  return (
    <label className="as">
      <span>Viewing as</span>
      <select defaultValue={uid} onChange={(e) => { location.href = `/api/as?uid=${e.target.value}&back=${encodeURIComponent(location.pathname)}`; }}>
        {['manager', 'strategist', 'editor'].map((role) => (
          <optgroup key={role} label={role[0].toUpperCase() + role.slice(1) + 's'}>
            {users.filter((u) => u.role === role).map((u) => <option key={u.id} value={u.id}>{u.person} ({u.role})</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export function ThemeToggle() {
  const [t, setT] = useState(null);
  useEffect(() => { setT(document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')); }, []);
  const flip = () => {
    const next = t === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch {}
    setT(next);
  };
  return (
    <button className="iconbtn" onClick={flip} title="Toggle light/dark" aria-label="Toggle light or dark theme">
      {t === 'dark'
        ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
        : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>}
    </button>
  );
}
