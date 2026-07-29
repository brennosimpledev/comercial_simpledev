import Link from "next/link";
import { LeadForm } from "@/components/leads/LeadForm";

export default function NovoLeadPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5">
        <Link href="/leads" className="text-sm text-slate-400 hover:text-brand">
          ← Voltar
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-white">Novo lead</h1>
        <p className="text-sm text-slate-400">
          Cadastro manual — indicações e leads inseridos pela equipe.
        </p>
      </div>

      <LeadForm />
    </div>
  );
}
