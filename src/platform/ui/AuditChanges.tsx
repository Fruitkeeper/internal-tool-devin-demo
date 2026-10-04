/** Shows which fields changed between an audit entry's before/after JSON snapshots. */
export function AuditChanges({ before, after }: { before: string | null; after: string | null }) {
  const b = (before ? JSON.parse(before) : {}) ?? {};
  const a = (after ? JSON.parse(after) : {}) ?? {};
  const keys = Object.keys({ ...b, ...a }).filter(
    (k) =>
      JSON.stringify(b[k]) !== JSON.stringify(a[k]) &&
      !["updatedAt", "createdAt"].includes(k) &&
      (before || a[k] !== null),
  );
  if (keys.length === 0) return null;
  const fmt = (v: unknown) => (v === undefined || v === null ? "∅" : typeof v === "string" ? v : JSON.stringify(v));
  return (
    <ul className="text-xs text-slate-600">
      {keys.map((k) => (
        <li key={k}>
          <span className="font-mono">{k}</span>: {before ? <>{fmt(b[k])} → </> : null}
          {fmt(a[k])}
        </li>
      ))}
    </ul>
  );
}
