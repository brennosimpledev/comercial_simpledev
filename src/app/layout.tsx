import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Comercial SimpleDEV",
  description: "CRM interno da SimpleDEV",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
