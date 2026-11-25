-- =====================================================================
-- GUMMI APP · Script 7: nota ajustada con estadísticas
-- Ejecutar DESPUÉS de los scripts 1 a 6.
-- Pegar entero en Supabase > SQL Editor > New query > Run
--
-- Qué hace:
--   La nota que sale de los votos se corrige un poco según cómo juega
--   cada uno de verdad (sus últimos 20 partidos). El ajuste nunca pasa de
--   +1,5 / -1,5 puntos y va entrando poco a poco (a pleno rendimiento desde
--   15 partidos jugados).
--
--   Se tiene en cuenta:
--     * Goles + asistencias por partido, comparado con lo normal para su
--       posición (a un delantero se le exige más que a un defensa o portero).
--     * Veces que ha sido MVP.
--     * Resultados de su equipo (victorias frente a derrotas).
--   En los porteros y defensas pesan más los resultados y menos los goles.
--
--   Hay un interruptor en la app (Votar > Ajustes) para activarlo/desactivarlo.
--   notas_jugadores() ahora devuelve también nota_votos (sin ajustar) y
--   ajuste. Solo la ve quien ya podía ver las notas.
--
-- Se puede ejecutar más de una vez.
-- =====================================================================

alter table public.configuracion
  add column if not exists usar_ajuste_stats boolean not null default true;

grant update (notas_visibles, votacion_inicial_abierta, usar_ajuste_stats)
  on public.configuracion to authenticated;

-- ---------- Cálculo interno del ajuste (no accesible desde la app) ----------
create or replace function public.ajuste_stats()
returns table (jugador_id uuid, ajuste numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with jugados as (
    select p.id, p.fecha, p.goles_a, p.goles_b, p.votacion_hasta
    from public.partidos p
    where p.estado in ('jugado', 'cerrado')
      and p.goles_a is not null
      and p.goles_b is not null
  ),
  recientes as (
    select pa.jugador_id, pa.partido_id, pa.equipo, pr.posicion,
           j.goles_a, j.goles_b,
           row_number() over (partition by pa.jugador_id order by j.fecha desc, j.id desc) as rn
    from public.participaciones pa
    join jugados j on j.id = pa.partido_id
    join public.perfiles pr on pr.id = pa.jugador_id
  ),
  sel as (
    select * from recientes where rn <= 20
  ),
  ev as (
    select e.partido_id, e.jugador_id, count(*) as ga
    from public.eventos e
    group by e.partido_id, e.jugador_id
  ),
  votos_por_partido as (
    select m.partido_id, m.votado_id, count(*) as n
    from public.votos_mvp m
    join jugados j on j.id = m.partido_id
    where j.votacion_hasta is not null
      and now() > j.votacion_hasta
    group by m.partido_id, m.votado_id
  ),
  mvp_g as (
    select x.partido_id, x.votado_id as jugador_id
    from (
      select vp.partido_id, vp.votado_id,
             rank() over (partition by vp.partido_id order by vp.n desc) as pos
      from votos_por_partido vp
    ) x
    where x.pos = 1
  ),
  agg as (
    select s.jugador_id,
           s.posicion,
           count(*)::numeric as pj,
           sum(coalesce(ev.ga, 0))::numeric as ga,
           count(*) filter (where (s.equipo = 'A' and s.goles_a > s.goles_b)
                               or (s.equipo = 'B' and s.goles_b > s.goles_a))::numeric as w,
           count(*) filter (where (s.equipo = 'A' and s.goles_a < s.goles_b)
                               or (s.equipo = 'B' and s.goles_b < s.goles_a))::numeric as l,
           count(mg.jugador_id)::numeric as m
    from sel s
    left join ev on ev.partido_id = s.partido_id and ev.jugador_id = s.jugador_id
    left join mvp_g mg on mg.partido_id = s.partido_id and mg.jugador_id = s.jugador_id
    group by s.jugador_id, s.posicion
  ),
  par as (
    select a.*,
           -- peso del rendimiento ofensivo según la posición
           case a.posicion when 'portero' then 0.10 when 'defensa' then 0.20
                           when 'medio' then 0.35 when 'delantero' then 0.45 else 0.30 end as w_of,
           0.20 as w_mvp,
           -- goles + asistencias por partido que se esperan de esa posición
           case a.posicion when 'portero' then 0.15 when 'defensa' then 0.50
                           when 'medio' then 0.80 when 'delantero' then 1.20 else 0.80 end as esperado
    from agg a
  ),
  puntos as (
    select p.jugador_id, p.pj,
           p.w_of,
           p.w_mvp,
           1 - p.w_of - p.w_mvp as w_res,
           greatest(-1, least(1, ((p.ga / p.pj) - p.esperado) / (p.esperado + 0.6))) as ofe,
           greatest(-0.3, least(1, 4 * (p.m / p.pj) - 0.3)) as mvp,
           (p.w - p.l) / p.pj as res
    from par p
  )
  select pt.jugador_id,
         case when coalesce((select c.usar_ajuste_stats from public.configuracion c), true)
              then round(
                     (1.5 * least(1, pt.pj / 15)
                      * (pt.w_of * pt.ofe + pt.w_mvp * pt.mvp + pt.w_res * pt.res))::numeric, 2)
              else 0::numeric end
  from puntos pt;
$$;

revoke execute on function public.ajuste_stats() from public, anon, authenticated;
grant  execute on function public.ajuste_stats() to service_role;

-- ---------- Notas: ahora con el ajuste ----------
drop function if exists public.notas_jugadores();

create or replace function public.notas_jugadores()
returns table (
  jugador_id uuid,
  nota       numeric,   -- nota final (con ajuste)
  num_votos  integer,
  fuente     text,
  nota_votos numeric,   -- nota solo por votos / manual
  ajuste     numeric    -- lo que suman o restan las estadísticas
)
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
  ),
  base as (
    select pr.id,
           coalesce(va.nota, nm.nota)::numeric as nota,
           coalesce(va.n_votos, 0)::integer as n_votos,
           (case when va.nota is not null then 'votos'
                 when nm.nota is not null then 'manual'
                 else 'sin_nota' end)::text as fuente
    from public.perfiles pr
    left join votos_agr va on va.votado_id = pr.id
    left join public.notas_manuales nm on nm.jugador_id = pr.id
    where pr.activo
  )
  select b.id,
         case when b.nota is null then null
              else greatest(1, least(10, b.nota + coalesce(aj.ajuste, 0))) end,
         b.n_votos,
         b.fuente,
         b.nota,
         case when b.nota is null then 0::numeric else coalesce(aj.ajuste, 0) end
  from base b
  left join public.ajuste_stats() aj on aj.jugador_id = b.id;
end;
$$;

revoke execute on function public.notas_jugadores() from public, anon;
grant  execute on function public.notas_jugadores() to authenticated, service_role;
