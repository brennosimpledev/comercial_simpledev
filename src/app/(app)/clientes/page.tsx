import { createClient } from "@/lib/supabase/server";
import { ClientesView } from "@/components/clientes/ClientesView";
import type { Lead } from "@/types/database";

export const dynamic = "force-dynamic";

export default async function ClientesPage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("ja_cliente", true)
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="py-12 text-center">
        <h1 className="mb-2 text-xl font-bold text-white">Clientes</h1>
        <p className="text-sm text-slate-400">
          Coluna <code>ja_cliente</code> não encontrada. Execute a migration
          0008 no SQL Editor do Supabase.
        </p>
      </div>
    );
  }

  return <ClientesView clientes={(data ?? []) as Lead[]} />;
}
