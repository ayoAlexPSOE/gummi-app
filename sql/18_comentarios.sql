-- =====================================================================
-- GUMMI APP · Script 18: comentarios de los partidos
-- Ejecutar DESPUÉS de los scripts 1 a 6 y 8 a 17.
-- Pegar entero en Supabase > SQL Editor > New query > Run
--
-- Qué hace (solo AÑADE una tabla nueva, no toca nada de lo que hay):
--   * Cada jugador puede comentar un partido ya jugado (máx. 500 caracteres).
--   * Todos ven los comentarios; cada uno puede borrar los suyos y el admin
--     puede borrar cualquiera.
-- Para deshacerlo: 18_comentarios_down.sql
-- Se puede ejecutar más de una vez.
-- =====================================================================

create table if not exists public.comentarios (
  id          bigint generated always as identity primary key,
  partido_id  bigint not null references public.partidos (id) on delete cascade,
  autor_id    uuid   not null references public.perfiles (id) on delete cascade,
  texto       text   not null check (char_length(btrim(texto)) between 1 and 500),
  created_at  timestamptz not null default now()
);
create index if not exists comentarios_partido_idx on public.comentarios (partido_id, created_at);

alter table public.comentarios enable row level security;

drop policy if exists "comentarios: ver" on public.comentarios;
create policy "comentarios: ver" on public.comentarios
  for select to authenticated using (true);

drop policy if exists "comentarios: escribir" on public.comentarios;
create policy "comentarios: escribir" on public.comentarios
  for insert to authenticated
  with check (
    autor_id = public.mi_perfil_id()
    and exists (select 1 from public.partidos p where p.id = partido_id and p.estado in ('jugado', 'cerrado'))
  );

drop policy if exists "comentarios: borrar" on public.comentarios;
create policy "comentarios: borrar" on public.comentarios
  for delete to authenticated
  using (autor_id = public.mi_perfil_id() or public.es_admin());

revoke all on public.comentarios from anon;
grant select, insert, delete on public.comentarios to authenticated;
grant all on public.comentarios to service_role;
