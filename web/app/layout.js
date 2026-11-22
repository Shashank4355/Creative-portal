import './globals.css';
import { users, currentUid } from '../lib/db';
import Switcher from './switcher';

export const metadata = { title: 'Creative Performance' };
export const dynamic = 'force-dynamic';

export default async function Layout({ children }) {
  const [list, uid] = [await users(), await currentUid()];
  return (
    <html lang="en"><body>
      <header>
        <b>Fernlow · Creative Performance</b>
        <nav><a href="/">Leaderboard</a><a href="/creatives">Creatives</a><a href="/checks">Data checks</a><a href="/launches">Launch queue</a></nav>
        <Switcher users={list} uid={uid} />
      </header>
      <main>{children}</main>
    </body></html>
  );
}
