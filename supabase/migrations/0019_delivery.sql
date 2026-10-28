-- Structured scope snapshots and execution. Existing lead documents stay intact.
create table public.delivery_projects (
 id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads(id),
 name text not null, owner_id uuid not null references auth.users(id),
 revision integer not null default 0, scope_status text not null default 'draft' check(scope_status in ('draft','review','approved')),
 approved_version integer, repository text, created_at timestamptz not null default now()
);
create table public.delivery_members(project_id uuid references public.delivery_projects on delete cascade,user_id uuid references auth.users,primary key(project_id,user_id));
create table public.delivery_scopes (
 project_id uuid references public.delivery_projects on delete cascade, version integer not null,
 document jsonb not null, request_id uuid not null, created_by uuid references auth.users,
 created_at timestamptz not null default now(), primary key(project_id,version),unique(project_id,request_id)
);
create table public.delivery_events (
 id uuid primary key default gen_random_uuid(),project_id uuid references public.delivery_projects on delete cascade,
 actor_id uuid references auth.users,kind text not null,version integer,details jsonb not null default '{}',created_at timestamptz not null default now()
);
create table public.delivery_requirements (
 project_id uuid,scope_version integer,requirement_id text,module_id text not null,
 inclusion text not null check(inclusion in ('included','optional','pending','excluded')),document jsonb not null,
 primary key(project_id,scope_version,requirement_id),
 foreign key(project_id,scope_version) references delivery_scopes(project_id,version) on delete cascade
);
create table public.delivery_plans (
 project_id uuid primary key references public.delivery_projects on delete cascade,revision integer not null default 1,
 document jsonb not null,baseline jsonb,updated_at timestamptz not null default now()
);
create table public.delivery_tokens (
 id uuid primary key default gen_random_uuid(),project_id uuid references public.delivery_projects on delete cascade,
 user_id uuid not null references auth.users,token_hash text not null unique,expires_at timestamptz not null,
 revoked_at timestamptz,created_at timestamptz not null default now()
);
create table public.delivery_tasks (
 project_id uuid references delivery_projects on delete cascade,task_id text,status text not null,
 requirement_ids jsonb not null,document jsonb not null,primary key(project_id,task_id)
);
create index delivery_tasks_status on delivery_tasks(project_id,status);
create table public.delivery_github (
 project_id uuid primary key references public.delivery_projects on delete cascade,
 repository text not null,evidence jsonb not null default '{}',synced_at timestamptz not null default now()
);
create table public.delivery_webhooks(delivery_id text primary key,received_at timestamptz not null default now());
create function public.delivery_access(p_project uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from delivery_projects where id=p_project and owner_id=auth.uid())
 or exists(select 1 from delivery_members where project_id=p_project and user_id=auth.uid());
$$;
revoke all on function public.delivery_access(uuid) from public;
grant execute on function public.delivery_access(uuid) to authenticated;
alter table public.delivery_projects enable row level security;
alter table public.delivery_members enable row level security;
alter table public.delivery_scopes enable row level security;
alter table public.delivery_events enable row level security;
alter table public.delivery_plans enable row level security;
alter table public.delivery_tokens enable row level security;
alter table public.delivery_github enable row level security;
alter table public.delivery_webhooks enable row level security;
alter table public.delivery_requirements enable row level security;
alter table public.delivery_tasks enable row level security;
create policy delivery_read_projects on delivery_projects for select to authenticated using(delivery_access(id));
create policy delivery_read_members on delivery_members for select to authenticated using(delivery_access(project_id));
create policy delivery_read_scopes on delivery_scopes for select to authenticated using(delivery_access(project_id));
create policy delivery_read_events on delivery_events for select to authenticated using(delivery_access(project_id));
create policy delivery_read_plans on delivery_plans for select to authenticated using(delivery_access(project_id));
create policy delivery_read_github on delivery_github for select to authenticated using(delivery_access(project_id));
create policy delivery_read_requirements on delivery_requirements for select to authenticated using(delivery_access(project_id));
create policy delivery_read_tasks on delivery_tasks for select to authenticated using(delivery_access(project_id));
-- All writes pass the server validation layer. RPC serializes concurrent updates.
create function public.delivery_write(p_project uuid,p_actor uuid,p_action text,p_expected integer,p_request uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p delivery_projects; existing delivery_scopes; n integer; plan delivery_plans;
begin
 select * into p from delivery_projects where id=p_project for update;
 if not found or not (p.owner_id=p_actor or exists(select 1 from delivery_members where project_id=p_project and user_id=p_actor)) then raise exception 'Acesso negado'; end if;
 if p_action='save_scope' then
  select * into existing from delivery_scopes where project_id=p_project and request_id=p_request;
  if found then
   if existing.document<>p_data then raise exception 'Chave de repetição com conteúdo diferente'; end if;
   return jsonb_build_object('version',existing.version);
  end if;
  if p.revision<>p_expected then raise exception 'Conflito de versão; recarregue o projeto'; end if;
  n:=p.revision+1;
  insert into delivery_scopes values(p_project,n,p_data,p_request,p_actor,now());
  insert into delivery_requirements(project_id,scope_version,requirement_id,module_id,inclusion,document)
   select p_project,n,r->>'id',r->>'moduleId',r->>'inclusion',r from jsonb_array_elements(p_data->'requirements') r;
  update delivery_projects set revision=n,scope_status='draft' where id=p_project;
 elsif p_action in ('review','approve') then
  if p.revision<>p_expected or p.revision=0 then raise exception 'Conflito de versão'; end if;
  if p_action='approve' then
   if p.owner_id<>p_actor or p.scope_status<>'review' then raise exception 'Aprovação exige responsável e revisão'; end if;
   if length(coalesce(p_data->>'evidence',''))<5 then raise exception 'Registre evidência da aprovação'; end if;
   if exists(select 1 from delivery_requirements where project_id=p_project and scope_version=p.revision and inclusion='pending')
    or exists(select 1 from delivery_scopes s cross join lateral jsonb_array_elements(s.document->'decisions') d where s.project_id=p_project and s.version=p.revision and (d->>'answer' is null or d->>'answer'='')) then raise exception 'Decisões pendentes'; end if;
   update delivery_projects set scope_status='approved',approved_version=revision where id=p_project;
  else
   if p.scope_status<>'draft' then raise exception 'Somente rascunhos podem ir para revisão'; end if;
   update delivery_projects set scope_status='review' where id=p_project;
  end if;
  n:=p.revision;
 elsif p_action in ('save_plan','baseline') then
  if p.scope_status<>'approved' or p.approved_version<>(p_data->>'scopeVersion')::integer then raise exception 'Plano exige escopo atual aprovado'; end if;
  select * into plan from delivery_plans where project_id=p_project;
  if coalesce(plan.revision,0)<>p_expected then raise exception 'Conflito no plano'; end if;
  if p_action='baseline' then
   if p.owner_id<>p_actor or plan.baseline is not null or plan.document<>p_data then raise exception 'Baseline já fixada ou plano alterado'; end if;
   update delivery_plans set baseline=document,revision=revision+1,updated_at=now() where project_id=p_project;
  else
   insert into delivery_plans(project_id,document) values(p_project,p_data)
   on conflict(project_id) do update set document=excluded.document,revision=delivery_plans.revision+1,updated_at=now();
   delete from delivery_tasks where project_id=p_project;
   insert into delivery_tasks(project_id,task_id,status,requirement_ids,document)
    select p_project,t->>'id',t->>'status',t->'requirementIds',t from jsonb_array_elements(p_data->'tasks') t;
  end if;
  n:=p_expected+1;
 else raise exception 'Operação inválida'; end if;
 insert into delivery_events(project_id,actor_id,kind,version,details) values(p_project,p_actor,p_action,n,case when p_action in ('approve','save_plan') then p_data else '{}'::jsonb end);
 return jsonb_build_object('version',n);
end; $$;
revoke all on function public.delivery_write(uuid,uuid,text,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.delivery_write(uuid,uuid,text,integer,uuid,jsonb) to service_role;
grant select on delivery_projects,delivery_members,delivery_scopes,delivery_events,delivery_plans,delivery_github to authenticated;
grant all on delivery_projects,delivery_members,delivery_scopes,delivery_events,delivery_plans,delivery_github,delivery_tokens,delivery_webhooks to service_role;
grant select on delivery_requirements,delivery_tasks to authenticated;
grant all on delivery_requirements,delivery_tasks to service_role;
