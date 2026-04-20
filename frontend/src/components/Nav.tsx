import { NavLink } from "react-router-dom";

const links = [
  ["/", "总览"],
  ["/doom", "DOOM"],
  ["/quake", "Quake"],
  ["/cnc", "C&C"],
  ["/source", "Source"],
  ["/freefire", "Free Fire"],
  ["/auth", "账号"],
  ["/arena", "WS Arena"]
] as const;

export default function Nav() {
  return (
    <nav className="nav">
      {links.map(([to, label]) => (
        <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "link active" : "link")}>
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
