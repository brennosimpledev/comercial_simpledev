import { WhatsAppConfig } from "@/components/configuracoes/WhatsAppConfig";
import { carregarWhatsApp } from "./actions";

export const dynamic = "force-dynamic";

export default async function ConfiguracoesPage() {
  const whatsapp = await carregarWhatsApp();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="mb-1 text-lg font-semibold text-white">Configurações</h1>
        <p className="text-sm text-slate-400">Conexões do CRM com o WhatsApp.</p>
      </div>
      {"error" in whatsapp ? (
        <p className="text-sm text-red-300">{whatsapp.error}</p>
      ) : (
        <WhatsAppConfig inicial={whatsapp} />
      )}
    </div>
  );
}
