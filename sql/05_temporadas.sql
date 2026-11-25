-- =====================================================================
-- GUMMI APP · Script 5: temporadas
-- Ejecutar DESPUÉS de los scripts 1, 2, 3 y 4.
-- Pegar entero en Supabase > SQL Editor > New query > Run
--
-- Qué hace:
--   * Crea "Temporada 1" (activa) si todavía no existe ninguna y le asigna
--     los partidos que ya tengas.
--   * Cada partido nuevo se asigna solo a la temporada activa.
--   * nueva_temporada(nombre): cierra la activa y abre una nueva (solo admin).
--   * El ranking se puede pedir por temporada o en histórico.
--
-- Las notas de los jugadores NO se reinician al cambiar de temporada.
-- Se puede ejecutar más de una vez.
-- =====================================================================

-- La versión anterior (sin parámetro) se sustituye por la nueva.
drop function if exists public.ranking_jugadores();

-- ---------- Primera temporada ----------
insert into public.temporadas (nombre, fecha_inicio, activa)
select 'Temporada 1', current_date, true
where not exists (select 1 from public.temporadas);

update public.partidos
set temporada_id = (select t.id from public.temporadas t where t.activa limit 1)
where temporada_id is null;

-- ---------- Partido nuevo -> temporada activa ----------
create or replace function public.asignar_temporada()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.temporada_id is null then
    select t.id into new.temporada_id from public.temporadas t where t.activa limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists partidos_asignar_temporada on public.partidos;
create trigger partidos_asignar_temporada
  before insert on public.partidos
  for each row execute function public.asignar_temporada();

-- ---------- Empezar una temporada nueva (solo admin) ----------
create or replace function public.nueva_temporada(p_nombre text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if not public.es_admin() then
    raise exception 'Solo un admin puede crear temporadas';
  end if;
  if coalesce(trim(p_nombre), '') = '' then
    raise exception 'Falta el nombre de la temporada';
  end if;

  update public.temporadas
  set activa = false, fecha_fin = coalesce(fecha_fin, current_date)
  where activa;

  insert into public.temporadas (nombre, fecha_inicio, activa)
  values (trim(p_nombre), current_date, true)
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.nueva_temporada(text) from public, anon;
grant  execute on function public.nueva_temporada(text) to authenticated, service_role;

-- ---------- Ranking por temporada (null = histórico) ----------
create or replace function public.ranking_jugadores(p_temporada bigint default null)
returns table (
  jugador_id  uuid,
  partidos    integer,
  victorias   integer,
  empates     integer,
  derrotas    integer,
  goles       integer,
  asistencias integer,
  mvps        integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with jugados as (
    select p.id, p.goles_a, p.goles_b, p.votacion_hasta
    from public.partidos p
    where p.estado in ('jugado', 'cerrado')
      and p.goles_a is not null
      and p.goles_b is not null
      and (p_temporada is null or p.temporada_id = p_temporada)
  ),
  resultados as (
    select pa.jugador_id,
           count(*) as partidos,
           count(*) filter (where (pa.equipo = 'A' and j.goles_a > j.goles_b)
                               or (pa.equipo = 'B' and j.goles_b > j.goles_a)) as victorias,
           count(*) filter (where j.goles_a = j.goles_b) as empates,
           count(*) filter (where (pa.equipo = 'A' and j.goles_a < j.goles_b)
                               or (pa.equipo = 'B' and j.goles_b < j.goles_a)) as derrotas
    from public.participaciones pa
    join jugados j on j.id = pa.partido_id
    group by pa.jugador_id
  ),
  eventos_j as (
    select e.jugador_id,
           count(*) filter (where e.tipo = 'gol')        as goles,
           count(*) filter (where e.tipo = 'asistencia') as asistencias
    from public.eventos e
    join jugados j on j.id = e.partido_id
    group by e.jugador_id
  ),
  votos_por_partido as (
    select m.partido_id, m.votado_id, count(*) as n
    from public.votos_mvp m
    join jugados j on j.id = m.partido_id
    where j.votacion_hasta is not null
      and now() > j.votacion_hasta
    group by m.partido_id, m.votado_id
  ),
  ganadores as (
    select x.votado_id as jugador_id, count(*) as mvps
    from (
      select vp.partido_id, vp.votado_id,
             rank() over (partition by vp.partido_id order by vp.n desc) as pos
      from votos_por_partido vp
    ) x
    where x.pos = 1
    group by x.votado_id
  )
  select pr.id,
         coalesce(r.partidos, 0)::integer,
         coalesce(r.victorias, 0)::integer,
         coalesce(r.empates, 0)::integer,
         coalesce(r.derrotas, 0)::integer,
         coalesce(e.goles, 0)::integer,
         coalesce(e.asistencias, 0)::integer,
         coalesce(g.mvps, 0)::integer
  from public.perfiles pr
  left join resultados r on r.jugador_id = pr.id
  left join eventos_j  e on e.jugador_id = pr.id
  left join ganadores  g on g.jugador_id = pr.id
  where pr.activo;
$$;

revoke execute on function public.ranking_jugadores(bigint) from public, anon;
grant  execute on function public.ranking_jugadores(bigint) to authenticated, service_role;
