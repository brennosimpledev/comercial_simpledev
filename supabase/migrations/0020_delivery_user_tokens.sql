-- New MCP connections are user-level, revocable, and do not expire.
-- Existing project tokens keep their project binding and 30-day expiry.
alter table public.delivery_tokens
  alter column project_id drop not null,
  alter column expires_at drop not null;

create index delivery_tokens_user_active
  on public.delivery_tokens(user_id, created_at desc)
  where revoked_at is null;
