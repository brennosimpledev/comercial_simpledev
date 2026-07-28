import { z } from "zod";

const emptyToUndef = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

// Validacao do cadastro manual de lead (indicacoes).
export const manualLeadSchema = z.object({
  nome: z.string().trim().min(1, "Nome é obrigatório"),
  email: z.preprocess(
    emptyToUndef,
    z.string().email("E-mail inválido").optional()
  ),
  whatsapp: z.preprocess(emptyToUndef, z.string().optional()),
  origem: z.enum([
    "google_ads",
    "meta_ads",
    "indicacao",
    "organico",
    "outro",
  ]),
  orcamento: z.preprocess(emptyToUndef, z.string().optional()),
  necessidade: z.preprocess(emptyToUndef, z.string().optional()),
  prazo: z.preprocess(emptyToUndef, z.string().optional()),
  estagio: z.enum([
    "novo",
    "sdr",
    "reuniao_marcada",
    "proposta",
    "fechado",
    "perdido",
  ]),
  anotacoes: z.preprocess(emptyToUndef, z.string().optional()),
});

export type ManualLeadInput = z.infer<typeof manualLeadSchema>;
