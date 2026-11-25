-- =====================================================================
-- GUMMI APP · Script 1 (v2): núcleo
-- Pegar entero en Supabase > SQL Editor > New query > Run
-- Crea: perfiles (con jugadores EXTERNOS), temporadas, partidos,
--       convocatorias, participaciones y eventos (goles/asistencias)
-- Incluye permisos (GRANT) y seguridad (RLS).
--
-- Si ya ejecutaste la versión anterior, este script la borra y la
-- recrea (la base de datos aún está vacía, no se pierde nada).
-- =====================================================================

-- ---------- LIMPIEZA (por si ya se ejecutó la v1) ----------
drop trigger  if exists on_auth_user_created on auth.users;
drop table    if exists public.eventos, public.participaciones, public.convocatorias,
                        public.partidos, public.temporadas, public.perfiles cascade;
drop function if exists public.crear_perfil_al_registrarse() cascade;
drop function if exists public.vincular_externo(uuid, uuid) cascade;
drop function if exists public.es_admin() cascade;
drop function if exists public.mi_perfil_id() cascade;
drop type     if exists public.rol_usuario, public.posicion, public.estado_partido,
                        public.equipo, public.tipo_evento, public.respuesta cascade;

-- ---------- TIPOS ----------
create type public.rol_usuario    as enum ('admin', 'jugador');
create type public.posicion       as enum ('portero', 'defensa', 'medio', 'delantero');
create type public.estado_partido as enum ('convocatoria', 'equipos', 'jugado', 'cerrado');
create type public.equipo         as enum ('A', 'B');
create type public.tipo_evento    as enum ('gol', 'asistencia');
create type public.respuesta      as enum ('voy', 'no_voy', 'duda');

-- ---------- PERFILES ----------
-- Un perfil por jugador. Si tiene cuenta, user_id apunta a su usuario.
-- Los EXTERNOS no tienen cuenta (user_id vacío) y los crea un admin.
create table public.perfiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique references auth.users (id) on delete set null,
  nombre      text not null,
  apodo       text,
  posicion    public.posicion,
  rol         public.rol_usuario not null default 'jugador',
  es_externo  boolean not null default false,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint externo_sin_cuenta check (not es_externo or user_id is null)
);

-- ¿Cuál es el perfil del usuario que está usando la app?
create or replace function public.mi_perfil_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.perfiles where user_id = auth.uid();
$$;

-- ¿El usuario actual es admin?
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.perfiles
    where user_id = auth.uid() and rol = 'admin'
  );
$$;

grant execute on function public.mi_perfil_id() to authenticated, service_role;
grant execute on function public.es_admin()     to authenticated, service_role;

-- Al registrarse un usuario, se crea su perfil automáticamente.
create or replace function public.crear_perfil_al_registrarse()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfiles (user_id, nombre)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nombre', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.crear_perfil_al_registrarse();

-- Vincular un EXTERNO con la cuenta de un jugador que acaba de registrarse:
-- conserva todo el histórico del externo y le quita la etiqueta.
-- (Se borra el perfil vacío que se creó automáticamente al registrarse.)
create or replace function public.vincular_externo(p_externo uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un admin puede vincular externos';
  end if;

  delete from public.perfiles where user_id = p_user_id and not es_externo;

  update public.perfiles
  set user_id = p_user_id, es_externo = false
  where id = p_externo and es_externo;

  if not found then
    raise exception 'El perfil indicado no es un externo';
  end if;
end;
$$;

grant execute on function public.vincular_externo(uuid, uuid) to authenticated, service_role;

-- ---------- TEMPORADAS ----------
create table public.temporadas (
  id           bigint generated always as identity primary key,
  nombre       text not null,
  fecha_inicio date not null,
  fecha_fin    date,
  activa       boolean not null default false
);

-- Solo puede haber una temporada activa a la vez.
create unique index una_temporada_activa on public.temporadas (activa) where activa;

-- ---------- PARTIDOS ----------
create table public.partidos (
  id           bigint generated always as identity primary key,
  temporada_id bigint references public.temporadas (id),
  fecha        timestamptz not null,
  lugar        text,
  estado       public.estado_partido not null default 'convocatoria',
  goles_a      integer,
  goles_b      integer,
  creado_por   uuid references public.perfiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index partidos_fecha_idx on public.partidos (fecha desc);

-- ---------- CONVOCATORIAS (voy / no voy / duda) ----------
create table public.convocatorias (
  partido_id  bigint not null references public.partidos (id) on delete cascade,
  jugador_id  uuid   not null references public.perfiles (id) on delete cascade,
  respuesta   public.respuesta not null,
  updated_at  timestamptz not null default now(),
  primary key (partido_id, jugador_id)
);

-- ---------- PARTICIPACIONES (quién jugó y en qué equipo) ----------
create table public.participaciones (
  partido_id bigint not null references public.partidos (id) on delete cascade,
  jugador_id uuid   not null references public.perfiles (id) on delete cascade,
  equipo     public.equipo not null,
  posicion   public.posicion,
  primary key (partido_id, jugador_id)
);

-- ---------- EVENTOS (cada gol y cada asistencia) ----------
create table public.eventos (
  id         bigint generated always as identity primary key,
  partido_id bigint not null references public.partidos (id) on delete cascade,
  jugador_id uuid   not null references public.perfiles (id) on delete cascade,
  tipo       public.tipo_evento not null,
  created_at timestamptz not null default now()
);

create index eventos_partido_idx on public.eventos (partido_id);
create index eventos_jugador_idx on public.eventos (jugador_id);

-- =====================================================================
-- SEGURIDAD (RLS) Y PERMISOS (GRANT)
-- Regla general: todos los usuarios registrados pueden LEER;
-- solo los admins crean/modifican partidos, equipos, eventos y externos.
-- =====================================================================

alter table public.perfiles        enable row level security;
alter table public.temporadas      enable row level security;
alter table public.partidos        enable row level security;
alter table public.convocatorias   enable row level security;
alter table public.participaciones enable row level security;
alter table public.eventos         enable row level security;

-- ---- perfiles ----
-- Cada uno edita solo su nombre, apodo y posición (el rol no se toca desde la app).
-- El admin puede editar a cualquiera y crear/borrar externos.
grant select, delete on public.perfiles to authenticated;
grant update (nombre, apodo, posicion) on public.perfiles to authenticated;
grant insert (nombre, apodo, posicion, es_externo) on public.perfiles to authenticated;
grant select, insert, update, delete on public.perfiles to service_role;

create policy "perfiles: ver todos"
  on public.perfiles for select to authenticated
  using (true);

create policy "perfiles: editar el propio o admin"
  on public.perfiles for update to authenticated
  using (user_id = auth.uid() or public.es_admin())
  with check (user_id = auth.uid() or public.es_admin());

create policy "perfiles: admin crea externos"
  on public.perfiles for insert to authenticated
  with check (public.es_admin() and es_externo);

create policy "perfiles: admin borra"
  on public.perfiles for delete to authenticated
  using (public.es_admin());

-- ---- temporadas ----
grant select, insert, update, delete on public.temporadas to authenticated;
grant select, insert, update, delete on public.temporadas to service_role;

create policy "temporadas: ver todas"
  on public.temporadas for select to authenticated
  using (true);

create policy "temporadas: gestiona admin"
  on public.temporadas for all to authenticated
  using (public.es_admin())
  with check (public.es_admin());

-- ---- partidos ----
grant select, insert, update, delete on public.partidos to authenticated;
grant select, insert, update, delete on public.partidos to service_role;

create policy "partidos: ver todos"
  on public.partidos for select to authenticated
  using (true);

create policy "partidos: gestiona admin"
  on public.partidos for all to authenticated
  using (public.es_admin())
  with check (public.es_admin());

-- ---- convocatorias ----
-- Cada jugador responde por sí mismo; el admin gestiona a cualquiera
-- (por ejemplo, a los externos que confirman por WhatsApp).
grant select, insert, update, delete on public.convocatorias to authenticated;
grant select, insert, update, delete on public.convocatorias to service_role;

create policy "convocatorias: ver todas"
  on public.convocatorias for select to authenticated
  using (true);

create policy "convocatorias: la propia o admin"
  on public.convocatorias for all to authenticated
  using (jugador_id = public.mi_perfil_id() or public.es_admin())
  with check (jugador_id = public.mi_perfil_id() or public.es_admin());

-- ---- participaciones ----
grant select, insert, update, delete on public.participaciones to authenticated;
grant select, insert, update, delete on public.participaciones to service_role;

create policy "participaciones: ver todas"
  on public.participaciones for select to authenticated
  using (true);

create policy "participaciones: gestiona admin"
  on public.participaciones for all to authenticated
  using (public.es_admin())
  with check (public.es_admin());

-- ---- eventos ----
grant select, insert, update, delete on public.eventos to authenticated;
grant select, insert, update, delete on public.eventos to service_role;

create policy "eventos: ver todos"
  on public.eventos for select to authenticated
  using (true);

create policy "eventos: gestiona admin"
  on public.eventos for all to authenticated
  using (public.es_admin())
  with check (public.es_admin());

-- =====================================================================
-- DESPUÉS DE REGISTRAR TU USUARIO (cuando la app esté lista), conviértete
-- en admin ejecutando esto en el SQL Editor con TU correo:
--
--   update public.perfiles
--   set rol = 'admin'
--   where user_id = (select id from auth.users where email = 'tu@correo.com');
-- =====================================================================
