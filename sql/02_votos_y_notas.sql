-- =====================================================================
-- GUMMI APP · Script 2: votos, MVP, notas privadas y cálculo de medias
-- Ejecutar DESPUÉS del script 1.
-- Pegar entero en Supabase > SQL Editor > New query > Run
--
-- Qué crea:
--   configuracion   -> interruptores (notas visibles, votación inicial abierta)
--   votos           -> votación inicial (partido_id vacío) y tras cada partido
--   votos_mvp       -> voto de MVP de cada partido
--   notas_manuales  -> nota que pone el admin (para externos o de apoyo)
--   Funciones       -> notas_jugadores() y mvp_resultado()
--
-- Privacidad:
--   * Cada jugador solo ve SUS votos (son anónimos, ni el admin los ve en la app).
--   * Las notas solo las ve el admin, hasta que se active "notas_visibles".
-- Se puede ejecutar más de una vez (borra y recrea lo de este script).
-- =====================================================================

-- ---------- LIMPIEZA ----------
drop trigger  if exists partidos_votacion_hasta on public.partidos;
drop table    if exists public.votos_mvp, public.votos,
                        public.notas_manuales, public.configuracion cascade;
drop function if exists public.notas_jugadores() cascade;
drop function if exists public.mvp_resultado(bigint) cascade;
drop function if exists public.voto_valido(uuid, uuid, bigint) cascade;
drop function if exists public.votacion_abierta(bigint) cascade;
drop function if exists public.fijar_votacion_hasta() cascade;
drop function if exists public.tocar_updated_at() cascade;

-- ---------- PARTIDOS: fin de la ventana de votación ----------
-- Al marcar un partido como 'jugado', se abre una ventana de 48 horas.
alter table public.partidos add column if not exists votacion_hasta timestamptz;

create or replace function public.fijar_votacion_hasta()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.estado = 'jugado' and new.votacion_hasta is null then
    new.votacion_hasta := now() + interval '48 hours';
  end if;
  return new;
end;
$$;

create trigger partidos_votacion_hasta
  before insert or update of estado on public.partidos
  for each row execute function public.fijar_votacion_hasta();

-- ---------- CONFIGURACIÓN (una sola fila) ----------
create table public.configuracion (
  id                        boolean primary key default true check (id),
  notas_visibles            boolean not null default false,
  votacion_inicial_abierta  boolean not null default true
);

insert into public.configuracion default values;

-- ---------- NOTAS MANUALES (solo admin) ----------
-- Para los externos (no se les puede votar) y como nota de apoyo
-- hasta que un jugador tenga votos.
create table public.notas_manuales (
  jugador_id uuid primary key references public.perfiles (id) on delete cascade,
  nota       numeric(3,1) not null check (nota between 1 and 10),
  updated_at timestamptz not null default now()
);

-- ---------- VOTOS ----------
-- partido_id vacío = votación inicial (todos a todos).
-- partido_id con valor = voto tras ese partido.
create table public.votos (
  id         bigint generated always as identity primary key,
  partido_id bigint references public.partidos (id) on delete cascade,
  votante_id uuid not null references public.perfiles (id) on delete cascade,
  votado_id  uuid not null references public.perfiles (id) on delete cascade,
  nota       numeric(3,1) not null check (nota between 1 and 10),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (votante_id <> votado_id),
  constraint votos_unico unique nulls not distinct (votante_id, votado_id, partido_id)
);

create index votos_votado_idx on public.votos (votado_id);

create or replace function public.tocar_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger votos_updated_at
  before update on public.votos
  for each row execute function public.tocar_updated_at();

-- ---------- VOTOS MVP ----------
create table public.votos_mvp (
  partido_id bigint not null references public.partidos (id) on delete cascade,
  votante_id uuid   not null references public.perfiles (id) on delete cascade,
  votado_id  uuid   not null references public.perfiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (partido_id, votante_id),
  check (votante_id <> votado_id)
);

-- ---------- REGLAS DE VOTACIÓN ----------
-- ¿Está abierta la votación? (inicial o de un partido)
create or replace function public.votacion_abierta(p_partido bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_partido is null then
      coalesce((select c.votacion_inicial_abierta from public.configuracion c), false)
    else
      exists (
        select 1 from public.partidos p
        where p.id = p_partido
          and p.estado = 'jugado'
          and p.votacion_hasta is not null
          and now() <= p.votacion_hasta
      )
  end;
$$;

-- ¿Es válido este voto?
--   * ni votante ni votado pueden ser externos
--   * no se puede votar a uno mismo
--   * la votación debe estar abierta
--   * en votos de partido, ambos deben haber jugado ese partido
create or replace function public.voto_valido(p_votante uuid, p_votado uuid, p_partido bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_votante <> p_votado
    and exists (select 1 from public.perfiles
                where id = p_votante and not es_externo and user_id is not null)
    and exists (select 1 from public.perfiles
                where id = p_votado and not es_externo)
    and public.votacion_abierta(p_partido)
    and (
      p_partido is null
      or (
        exists (select 1 from public.participaciones
                where partido_id = p_partido and jugador_id = p_votante)
        and exists (select 1 from public.participaciones
                    where partido_id = p_partido and jugador_id = p_votado)
      )
    );
$$;

-- ---------- RESULTADO DEL MVP ----------
-- Visible para todos, pero solo cuando la ventana de votación ha terminado.
create or replace function public.mvp_resultado(p_partido bigint)
returns table (jugador_id uuid, num_votos integer)
language sql
stable
security definer
set search_path = ''
as $$
  select m.votado_id, count(*)::integer
  from public.votos_mvp m
  join public.partidos p on p.id = m.partido_id
  where m.partido_id = p_partido
    and p.votacion_hasta is not null
    and now() > p.votacion_hasta
  group by m.votado_id
  order by 2 desc;
$$;

-- ---------- NOTAS DE LOS JUGADORES ----------
-- Solo la puede llamar el admin, o cualquiera si notas_visibles = true.
--
-- Cálculo:
--   * Votación inicial: media recortada (si hay 5 votos o más, se descartan
--     la nota más alta y la más baja). Pesa como 3 partidos.
--   * Cada partido: media de los votos recibidos en ese partido.
--   * Todo se pondera por antigüedad: cada 90 días el peso se reduce a la mitad,
--     así la nota refleja la forma actual sin saltos bruscos.
--   * Sin votos: se usa la nota manual del admin (externos o jugadores nuevos).
create or replace function public.notas_jugadores()
returns table (jugador_id uuid, nota numeric, num_votos integer, fuente text)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if not (public.es_admin()
          or coalesce((select c.notas_visibles from public.configuracion c), false)) then
    raise exception 'Las notas no son visibles';
  end if;

  return query
  with inicial as (
    select v.votado_id, v.nota, v.created_at,
           row_number() over (partition by v.votado_id order by v.nota, v.id)      as r_asc,
           row_number() over (partition by v.votado_id order by v.nota desc, v.id) as r_desc,
           count(*)     over (partition by v.votado_id)                            as n
    from public.votos v
    where v.partido_id is null
  ),
  obs_inicial as (
    select i.votado_id,
           avg(i.nota) filter (where i.n < 5 or (i.r_asc > 1 and i.r_desc > 1)) as nota,
           3 * power(0.5, extract(epoch from (now() - max(i.created_at))) / (86400 * 90)) as peso,
           count(*) as n_votos
    from inicial i
    group by i.votado_id
  ),
  obs_partido as (
    select v.votado_id,
           avg(v.nota) as nota,
           power(0.5, extract(epoch from (now() - p.fecha)) / (86400 * 90)) as peso,
           count(*) as n_votos
    from public.votos v
    join public.partidos p on p.id = v.partido_id
    group by v.votado_id, v.partido_id, p.fecha
  ),
  todas as (
    select * from obs_inicial
    union all
    select * from obs_partido
  ),
  votos_agr as (
    select t.votado_id,
           round(sum(t.nota * t.peso) / sum(t.peso), 2) as nota,
           sum(t.n_votos)::integer as n_votos
    from todas t
    group by t.votado_id
  )
  select pr.id,
         coalesce(va.nota, nm.nota)::numeric,
         coalesce(va.n_votos, 0)::integer,
         (case when va.nota is not null then 'votos'
               when nm.nota is not null then 'manual'
               else 'sin_nota' end)::text
  from public.perfiles pr
  left join votos_agr va on va.votado_id = pr.id
  left join public.notas_manuales nm on nm.jugador_id = pr.id
  where pr.activo;
end;
$$;

grant execute on function public.votacion_abierta(bigint)         to authenticated, service_role;
grant execute on function public.voto_valido(uuid, uuid, bigint)  to authenticated, service_role;
grant execute on function public.mvp_resultado(bigint)            to authenticated, service_role;
grant execute on function public.notas_jugadores()                to authenticated, service_role;

-- =====================================================================
-- SEGURIDAD (RLS) Y PERMISOS (GRANT)
-- =====================================================================

alter table public.configuracion  enable row level security;
alter table public.notas_manuales enable row level security;
alter table public.votos          enable row level security;
alter table public.votos_mvp      enable row level security;

-- ---- configuracion: la lee cualquiera, la cambia el admin ----
grant select on public.configuracion to authenticated;
grant update (notas_visibles, votacion_inicial_abierta) on public.configuracion to authenticated;
grant select, insert, update, delete on public.configuracion to service_role;

create policy "configuracion: ver"
  on public.configuracion for select to authenticated
  using (true);

create policy "configuracion: cambia admin"
  on public.configuracion for update to authenticated
  using (public.es_admin())
  with check (public.es_admin());

-- ---- notas_manuales: solo admin ----
grant select, insert, update, delete on public.notas_manuales to authenticated;
grant select, insert, update, delete on public.notas_manuales to service_role;

create policy "notas_manuales: solo admin"
  on public.notas_manuales for all to authenticated
  using (public.es_admin())
  with check (public.es_admin());

-- ---- votos: cada jugador solo ve y gestiona los suyos ----
-- (el admin NO tiene acceso a los votos individuales: son anónimos)
grant select, delete on public.votos to authenticated;
grant insert (partido_id, votante_id, votado_id, nota) on public.votos to authenticated;
grant update (partido_id, votante_id, votado_id, nota) on public.votos to authenticated;
grant select, insert, update, delete on public.votos to service_role;

create policy "votos: ver los propios"
  on public.votos for select to authenticated
  using (votante_id = public.mi_perfil_id());

create policy "votos: emitir"
  on public.votos for insert to authenticated
  with check (
    votante_id = public.mi_perfil_id()
    and public.voto_valido(votante_id, votado_id, partido_id)
  );

create policy "votos: corregir mientras esté abierta"
  on public.votos for update to authenticated
  using (votante_id = public.mi_perfil_id() and public.votacion_abierta(partido_id))
  with check (
    votante_id = public.mi_perfil_id()
    and public.voto_valido(votante_id, votado_id, partido_id)
  );

create policy "votos: borrar mientras esté abierta"
  on public.votos for delete to authenticated
  using (votante_id = public.mi_perfil_id() and public.votacion_abierta(partido_id));

-- ---- votos_mvp: igual que votos ----
grant select, delete on public.votos_mvp to authenticated;
grant insert (partido_id, votante_id, votado_id) on public.votos_mvp to authenticated;
grant update (partido_id, votante_id, votado_id) on public.votos_mvp to authenticated;
grant select, insert, update, delete on public.votos_mvp to service_role;

create policy "mvp: ver el propio"
  on public.votos_mvp for select to authenticated
  using (votante_id = public.mi_perfil_id());

create policy "mvp: emitir"
  on public.votos_mvp for insert to authenticated
  with check (
    votante_id = public.mi_perfil_id()
    and public.voto_valido(votante_id, votado_id, partido_id)
  );

create policy "mvp: corregir mientras esté abierta"
  on public.votos_mvp for update to authenticated
  using (votante_id = public.mi_perfil_id() and public.votacion_abierta(partido_id))
  with check (
    votante_id = public.mi_perfil_id()
    and public.voto_valido(votante_id, votado_id, partido_id)
  );

create policy "mvp: borrar mientras esté abierta"
  on public.votos_mvp for delete to authenticated
  using (votante_id = public.mi_perfil_id() and public.votacion_abierta(partido_id));

-- =====================================================================
-- CÓMO SE USA (más adelante, desde la app):
--   * El admin cierra la votación inicial:
--       update public.configuracion set votacion_inicial_abierta = false;
--   * El admin hace visibles las notas a todos:
--       update public.configuracion set notas_visibles = true;
--   * Ver las notas (solo admin mientras notas_visibles sea false):
--       select * from public.notas_jugadores();
-- =====================================================================
