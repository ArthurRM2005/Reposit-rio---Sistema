-- Execute este script no Supabase: Dashboard > SQL Editor > New query > cole e rode.

-- Tabela única com os registros de todas as abas (comercial, cs, config, status, heartbeat).
create table if not exists public.registros (
  tabela     text        not null,
  id         text        not null,
  data       jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (tabela, id)
);
create index if not exists registros_tabela_idx on public.registros (tabela, updated_at desc);

-- Segurança: apenas usuários logados leem e gravam.
alter table public.registros enable row level security;

drop policy if exists "usuarios logados leem" on public.registros;
create policy "usuarios logados leem" on public.registros
  for select to authenticated using (true);

drop policy if exists "usuarios logados gravam" on public.registros;
create policy "usuarios logados gravam" on public.registros
  for all to authenticated using (true) with check (true);

-- Heartbeat: permite que sistemas externos (ex.: serviço de push de pedidos)
-- avisem que estão vivos sem precisar de login. Só aceita os IDs listados abaixo
-- e só altera o horário do último sinal.
create or replace function public.heartbeat(servico text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if servico not in ('push_pedidos', 'chatpro', 'hub_savassi', 'hub_cidadenova', 'hub_pampulha', 'hub_buritis') then
    raise exception 'servico desconhecido: %', servico;
  end if;
  insert into registros (tabela, id, data, updated_at)
  values ('heartbeat', servico, jsonb_build_object('at', now()), now())
  on conflict (tabela, id) do update set data = excluded.data, updated_at = now();
end;
$$;

revoke all on function public.heartbeat(text) from public;
grant execute on function public.heartbeat(text) to anon, authenticated;
