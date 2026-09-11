import { NavLink, Outlet } from 'react-router-dom';
import { Flag, Heart } from 'lucide-react';

export default function ProgressTabs() {
  return <>
    <nav aria-label="Progress views" className="mb-4 flex flex-wrap gap-1 border-b border-border">
      {[{ to: '/dare-board', name: 'Dare Board', Icon: Flag }, { to: '/donation-progress', name: 'Donation Progress', Icon: Heart }].map(({ to, name, Icon }) =>
        <NavLink key={to} to={to} className={({ isActive }) => `flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold ${isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>
          <Icon size={18} />{name}
        </NavLink>)}
    </nav>
    <Outlet />
  </>;
}
