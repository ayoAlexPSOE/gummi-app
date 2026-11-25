-- =====================================================================
-- GUMMI APP · Script 4: ranking de jugadores
-- Ejecutar DESPUÉS de los scripts 1, 2 y 3.
-- Pegar entero en Supabase > SQL Editor > New query > Run
--
-- Crea la función ranking_jugadores(), que devuelve por jugador:
--   partidos, victorias, empates, derrotas, goles, asistencias y MVPs.
-- Se calcula siempre al momento a partir de los partidos jugados,
-- así que no hay que mantener nada a mano.
-- Los MVP solo cuentan cuando ha terminado la ventana de votación.
-- Se puede ejecutar más de una vez.
-- =====================================================================

create or replace function public.ranking_jugadores()
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

revoke execute on function public.ranking_jugadores() from public, anon;
grant  execute on function public.ranking_jugadores() to authenticated, service_role;
