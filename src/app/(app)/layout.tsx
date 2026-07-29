import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NavLink } from "@/components/ui/NavLink";
import { signOut } from "./actions";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-white/10 bg-navy/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold text-white">
              Comercial <span className="text-brand">SimpleDEV</span>
            </span>
            <nav className="flex items-center gap-1">
              <NavLink href="/leads">Leads</NavLink>
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-slate-400 sm:block">
              {user.email}
            </span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-white/5"
              >
                Sair
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
