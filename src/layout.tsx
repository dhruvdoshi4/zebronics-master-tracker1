import { Link, NavLink, Outlet } from "react-router-dom";
import { BarChart3, Database, LogOut, Package, Search } from "lucide-react";
import { useAuth } from "./use-auth";
import { Logo } from "./ui";
import { cn } from "./utils";

const navItems = [
  { to: "/app/upload", label: "Upload Center", icon: Database },
  { to: "/app/asin", label: "Product Lookup", icon: Search },
  { to: "/app/amazon", label: "Amazon Dashboard", icon: BarChart3 },
  { to: "/app/flipkart", label: "Flipkart Dashboard", icon: BarChart3 },
  { to: "/app/products", label: "Product Master", icon: Package },
];

export function AppLayout() {
  const { signOut, profile } = useAuth();

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-50 via-violet-50/40 to-sky-50/40 text-zinc-900 dark:from-zinc-950 dark:via-zinc-950 dark:to-zinc-900 dark:text-zinc-100">
      <div className="mx-auto grid min-h-screen max-w-7xl grid-cols-1 md:grid-cols-[240px_1fr] lg:grid-cols-[260px_1fr]">
        <aside className="border-b border-zinc-200/70 bg-white/70 p-4 backdrop-blur md:border-b-0 md:border-r dark:border-zinc-800/60 dark:bg-zinc-900/70">
          <Link
            to="/app/upload"
            className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-violet-600 to-fuchsia-600 p-4 text-white shadow-lg shadow-violet-200/60 dark:shadow-none"
          >
            <Logo size={44} className="ring-2 ring-white/30" />
            <div className="min-w-0">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-violet-100">
                Zebronics
              </p>
              <p className="text-lg font-semibold leading-tight">
                Master Tracker
              </p>
              <p className="mt-0.5 text-[11px] text-violet-100">
                Monitor + Projector
              </p>
            </div>
          </Link>

          <nav className="mt-5 grid gap-1 md:block md:space-y-1 grid-cols-2 sm:grid-cols-3 md:grid-cols-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition",
                      isActive
                        ? "bg-violet-600 text-white shadow-sm"
                        : "text-zinc-600 hover:bg-violet-100/70 hover:text-violet-700 dark:text-zinc-300 dark:hover:bg-zinc-800",
                    )
                  }
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="mt-6 hidden rounded-xl border border-zinc-200/80 bg-white/60 p-3 text-sm md:block dark:border-zinc-800/80 dark:bg-zinc-900/60">
            <p className="font-medium text-zinc-900 dark:text-zinc-100">
              {profile?.full_name ?? "Team Member"}
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Role: {profile?.role ?? "viewer"}
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              void signOut();
            }}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white/60 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </aside>

        <main className="p-4 sm:p-6 md:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
