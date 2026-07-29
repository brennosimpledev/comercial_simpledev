"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");

  return (
    <Link
      href={href}
      className={
        "rounded-lg px-3 py-2 text-sm font-medium transition " +
        (active
          ? "bg-brand text-navy"
          : "text-slate-300 hover:bg-white/5")
      }
    >
      {children}
    </Link>
  );
}
