-- =====================================================================
-- GUMMI APP · Script 12: once ideal del partido
-- Ejecutar DESPUÉS de los scripts anteriores.
-- Pegar entero en Supabase > SQL Editor > New query > Run
--
-- Qué hace:
--   once_ideal(partido): devuelve los 6 jugadores de campo (sin portero)
--   que mejor nota media recibieron en la votación de ese partido, con sus
--   goles, asistencias y si fue MVP. El MVP siempre entra.
--   Solo funciona cuando la votación de ese partido ya ha terminado (si
--   no, se verían votos a medias). Sin partido, usa el último terminado.
--   Los votos individuales siguen siendo privados: solo se publica la
--   media de cada jugador en ese partido.
-- Se puede ejecutar más de una vez.
-- =====================================================================

create or replace function public.once_ideal(p_partido bigint default null)
returns table (
  partido_id  bigint,
  fecha       timestamptz,
  goles_a     integer,
  goles_b     integer,
  jugador_id  uuid,
  nota        numeric,
  num_votos   integer,
  goles       integer,
  asistencias integer,
  es_mvp      boolean,
  posicion    text,
  equipo      text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Hay que iniciar sesión';
  end if;

  if p_partido is null then
    select p.id into v_id
    from public.partidos p
    where p.estado in ('jugado', 'cerrado')
      and p.votacion_hasta is not null and p.votacion_hasta < now()
      and exists (select 1 from public.votos v where v.partido_id = p.id)
    order by p.fecha desc, p.id desc
    limit 1;
  else
    select p.id into v_id
    from public.partidos p
    where p.id = p_partido
      and p.estado in ('jugado', 'cerrado')
      and p.votacion_hasta is not null and p.votacion_hasta < now();
  end if;

  if v_id is null then
    return;
  end if;

  return query
  with notas as (
    select x.votado_id as jid,
           round(avg(x.nota) filter (where x.n < 5 or (x.ra > 1 and x.rd > 1)), 2) as nota,
           max(x.n)::integer as n
    from (
      select v.votado_id, v.nota,
             row_number() over (partition by v.votado_id order by v.nota, v.id)      as ra,
             row_number() over (partition by v.votado_id order by v.nota desc, v.id) as rd,
             count(*)     over (partition by v.votado_id)                            as n
      from public.votos v
      where v.partido_id = v_id
    ) x
    group by x.votado_id
  ),
  mvp as (
    select y.votado_id as jid
    from (
      select m.votado_id,
             rank() over (order by count(*) desc) as pos
      from public.votos_mvp m
      where m.partido_id = v_id
      group by m.votado_id
    ) y
    where y.pos = 1
  ),
  ev as (
    select e.jugador_id as jid,
           count(*) filter (where e.tipo = 'gol')        as g,
           count(*) filter (where e.tipo = 'asistencia') as a
    from public.eventos e
    where e.partido_id = v_id
    group by e.jugador_id
  ),
  cand as (
    select pa.jugador_id as jid,
           n.nota, n.n,
           coalesce(ev.g, 0) as g, coalesce(ev.a, 0) as a,
           (mvp.jid is not null) as es_mvp,
           coalesce(pa.posicion::text, pr.posicion::text) as pos,
           pa.equipo::text as equipo
    from public.participaciones pa
    join public.perfiles pr on pr.id = pa.jugador_id
    join notas n on n.jid = pa.jugador_id
    left join ev  on ev.jid  = pa.jugador_id
    left join mvp on mvp.jid = pa.jugador_id
    where pa.partido_id = v_id
      and coalesce(pa.posicion::text, pr.posicion::text, '') <> 'portero'
  ),
  elegidos as (
    select c.*
    from cand c
    order by (case when c.es_mvp then 100 else 0 end) + c.nota desc,
             (c.g + c.a) desc
    limit 6
  )
  select p.id, p.fecha, p.goles_a, p.goles_b,
         e.jid, e.nota, e.n, e.g::integer, e.a::integer, e.es_mvp, e.pos, e.equipo
  from elegidos e
  join public.partidos p on p.id = v_id
  order by e.nota desc, (e.g + e.a) desc;
end;
$$;

revoke execute on function public.once_ideal(bigint) from public, anon;
grant  execute on function public.once_ideal(bigint) to authenticated, service_role;
