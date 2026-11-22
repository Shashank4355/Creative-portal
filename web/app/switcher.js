'use client';
export default function Switcher({ users, uid }) {
  return (
    <div className="as">Viewing as{' '}
      <select defaultValue={uid} onChange={(e) => { location.href = `/api/as?uid=${e.target.value}&back=${encodeURIComponent(location.pathname)}`; }}>
        {users.map((u) => <option key={u.id} value={u.id}>{u.person} ({u.role})</option>)}
      </select>
    </div>
  );
}
