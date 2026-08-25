"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

// Volta no historico em vez de ir para /leads puro, para nao descartar os
// filtros de periodo/origem que ficam na query string da listagem.
// Se nao houver historico (link aberto direto), cai no href normal.
export function BackLink({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();

  return (
    <Link
      href={href}
      className={className}
      onClick={(e) => {
        if (window.history.length > 1) {
          e.preventDefault();
          router.back();
        }
      }}
    >
      {children}
    </Link>
  );
}
