# Comercial SimpleDEV — CRM (Fase 1)

CRM interno da SimpleDEV. Stack: **Next.js (App Router) + Supabase (Postgres + Auth)**, deploy na **Vercel**.

## Fase 1 — entregue

- Login da equipe (Supabase Auth, e-mail/senha)
- Pipeline em Kanban com drag-and-drop (`Novo → SDR → Reunião Marcada → Proposta → Fechado / Perdido`)
- Webhook para receber leads da LP (`POST /api/webhook/lead`)
- Cadastro manual de leads (indicações)
- Lista de leads + tela de detalhe com anotações

---

## 1. Configurar o Supabase

1. Crie um projeto em https://supabase.com.
2. Em **SQL Editor**, cole e rode o conteúdo de [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql).
3. Em **Project Settings → API**, copie:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` (secreto!)
4. Em **Authentication → Users**, crie os usuários da equipe (não há cadastro público).
5. Em **Authentication → Providers → Email**, deixe "Confirm email" **desligado** para os usuários criados manualmente já entrarem.

## 2. Variáveis de ambiente

Copie `.env.example` para `.env.local` (dev) e configure as mesmas na Vercel:

| Variável | Onde |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase API (server-only) |
| `LEAD_WEBHOOK_SECRET` | valor aleatório forte |

## 3. Deploy na Vercel

- Conecte o repositório na Vercel (framework detectado: Next.js).
- Adicione as 4 variáveis acima em **Settings → Environment Variables**.
- Deploy. Depois aponte `crm.simpledev.com.br` em **Settings → Domains**.

## 4. Configurar o webhook na LP

A LP deve fazer `POST` para:

```
https://crm.simpledev.com.br/api/webhook/lead
```

Com header:

```
x-webhook-secret: <valor de LEAD_WEBHOOK_SECRET>
Content-Type: application/json
```

E o payload JSON atual da LP (nome, email, whatsapp, utm_*, gclid, etc.).
O mapeamento payload → banco está em [`src/lib/mappers/webhook-lead.ts`](src/lib/mappers/webhook-lead.ts).

Teste rápido (troque a URL e o segredo):

```bash
curl -X POST https://crm.simpledev.com.br/api/webhook/lead \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: SEU_SEGREDO" \
  -d '{"nome":"Teste Lead","email":"teste@ex.com","whatsapp":"11999999999","utm_source":"google","gclid":"abc123","necessidade":"Site novo","orcamento":"10-20k"}'
```

---

## Observação sobre o campo `estagio` do payload

O payload da LP traz um campo `estagio` que representa o **momento de compra do cliente**, não o estágio do funil comercial. Por isso todo lead do webhook entra como **`novo`** no pipeline, e o valor original fica preservado em `raw_payload`.
