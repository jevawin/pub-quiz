import { NavLink } from 'react-router-dom';

const LINKS = [
  { to: '/admin', label: 'Tree', end: true },
  { to: '/admin/changes', label: 'Changes' },
  { to: '/admin/rules', label: 'Rules' },
  { to: '/admin/sweeps', label: 'Sweeps' },
];

export function AdminNav() {
  return (
    <nav aria-label="Admin" className="flex gap-4 border-b pb-2 text-sm">
      {LINKS.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          end={l.end}
          className={({ isActive }) => (isActive ? 'font-semibold underline' : 'text-neutral-500')}
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  );
}
