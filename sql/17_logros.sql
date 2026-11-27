-- =====================================================================
-- GUMMI APP · Script 17: logros reformulados
-- Ejecutar DESPUÉS de los scripts 1 a 6 y 8 a 16.
-- Pegar entero en Supabase > SQL Editor > New query > Run
--
-- Qué hace:
--   * Retira los logros flojos: Muro (porteros), 25 goles, 25 asistencias,
--     25 partidos y MVP x3. No se borran del catálogo: se marcan como
--     retirados (columna nueva "activo") y se quitan a quien los tenía.
--   * Añade dos nuevos: Debutante (juega tu primer partido) y Todoterreno
--     (gol y asistencia en el mismo partido).
--   * Les pone nombres con más gracia (Se estrena, Killer, El cerebro…).
--   * Recalcula todo sin mandar avisos de logros antiguos.
-- Para deshacerlo: 17_logros_down.sql
-- Se puede ejecutar más de una vez.
-- =====================================================================

alter table public.logros add column if not exists activo boolean not null default true;

insert into public.logros (id, nombre, descripcion, icono, repetible, orden, activo) values
  ('debut',               'Debutante',           'Juega tu primer partido con la peña',             '🎬', false,  5, true),
  ('primer_gol',          'Se estrena',          'Marca tu primer gol',                             '⚽', false, 10, true),
  ('goles_10',            'Killer',              'Llega a 10 goles',                                '🎯', false, 11, true),
  ('goles_50',            'Leyenda',             'Llega a 50 goles',                                '🚀', false, 13, true),
  ('asist_10',            'El cerebro',          'Llega a 10 asistencias',                          '🧠', false, 20, true),
  ('partidos_10',         'Fijo',                'Juega 10 partidos',                               '👟', false, 30, true),
  ('partidos_50',         'Veterano',            'Juega 50 partidos',                               '🏅', false, 32, true),
  ('hat_trick',           'Hat-trick',           '3 goles o más en un partido',                     '🎩', true,  40, true),
  ('poker',               'Póker',               '4 goles o más en un partido',                     '🃏', true,  41, true),
  ('asist_3',             'Repartidor',          '3 asistencias o más en un partido',               '🎁', true,  42, true),
  ('todoterreno',         'Todoterreno',         'Gol y asistencia en el mismo partido',            '🔀', true,  43, true),
  ('goleada',             'Paliza',              'Gana un partido por 5 goles o más',               '💥', true,  44, true),
  ('racha_3',             'En racha',            '3 victorias seguidas',                            '🔥', false, 50, true),
  ('racha_5',             'Imparable',           '5 victorias seguidas',                            '🌪️', false, 51, true),
  ('mvp_1',               'Primer MVP',          'Sé el MVP de un partido',                         '🏆', false, 60, true),
  ('mvp_5',               'El jefe',             'Sé MVP en 5 partidos',                            '👑', false, 62, true),
  ('asistencia_perfecta', 'Ni un día libre',     'No faltar a ningún partido de una temporada (mínimo 5)', '📅', true, 70, true),
  ('pichichi',            'Pichichi',            'Máximo goleador de una temporada',                '🥾', true,  71, true),
  ('asistente_temporada', 'Mejor asistente',     'Máximo asistente de una temporada',               '🤝', true,  72, true),
  ('mvp_temporada',       'MVP de la temporada', 'Más MVP de una temporada',                        '⭐', true,  73, true),
  ('campeon_temporada',   'Campeón',             'Más victorias de una temporada',                  '🥇', true,  74, true)
on conflict (id) do update
  set nombre = excluded.nombre, descripcion = excluded.descripcion, icono = excluded.icono,
      repetible = excluded.repetible, orden = excluded.orden, activo = true;

-- Retirados
update public.logros set activo = false where id in ('muro', 'goles_25', 'asist_25', 'partidos_25', 'mvp_3');
delete from public.logros_jugador where logro_id in (select id from public.logros where not activo);

-- ---------- Cálculo (con los logros nuevos y sin los retirados) ----------
create or replace function public.recalcular_logros()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.logros_jugador (jugador_id, logro_id, ref)
  with
  jugados as (
    select p.id, p.fecha, p.temporada_id, p.goles_a, p.goles_b, p.votacion_hasta
    from public.partidos p
    where p.estado in ('jugado', 'cerrado')
      and p.goles_a is not null
      and p.goles_b is not null
  ),
  ev as (
    select e.partido_id, e.jugador_id,
           count(*) filter (where e.tipo = 'gol')        as g,
           count(*) filter (where e.tipo = 'asistencia') as a
    from public.eventos e
    join jugados j on j.id = e.partido_id
    group by e.partido_id, e.jugador_id
  ),
  pp as (
    select pa.partido_id, pa.jugador_id, j.fecha, j.temporada_id,
           coalesce(pa.posicion, pr.posicion) as posicion,
           case when pa.equipo = 'A' then j.goles_a else j.goles_b end as gf,
           case when pa.equipo = 'A' then j.goles_b else j.goles_a end as gc,
           coalesce(ev.g, 0) as g,
           coalesce(ev.a, 0) as a
    from public.participaciones pa
    join jugados j on j.id = pa.partido_id
    join public.perfiles pr on pr.id = pa.jugador_id
    left join ev on ev.partido_id = pa.partido_id and ev.jugador_id = pa.jugador_id
  ),
  tot as (
    select jugador_id, count(*) as pj, sum(g) as g, sum(a) as a
    from pp
    group by jugador_id
  ),
  ordenados as (
    select jugador_id, (gf > gc) as victoria,
           row_number() over (partition by jugador_id order by fecha, partido_id) as rn,
           row_number() over (partition by jugador_id, (gf > gc) order by fecha, partido_id) as rv
    from pp
  ),
  rachas as (
    select jugador_id, max(c) as mx
    from (
      select jugador_id, count(*) as c
      from ordenados
      where victoria
      group by jugador_id, rn - rv
    ) x
    group by jugador_id
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
  mvp_tot as (
    select jugador_id, count(*) as n from mvp_g group by jugador_id
  ),
  -- Temporadas ya cerradas
  cerradas as (
    select t.id from public.temporadas t where not t.activa
  ),
  partidos_temp as (
    select j.temporada_id, count(*) as n
    from jugados j
    where j.temporada_id in (select id from cerradas)
    group by j.temporada_id
  ),
  temp_j as (
    select pp.temporada_id, pp.jugador_id,
           count(*) as pj,
           sum(pp.g) as g,
           sum(pp.a) as a,
           count(*) filter (where pp.gf > pp.gc) as w
    from pp
    where pp.temporada_id in (select id from cerradas)
    group by pp.temporada_id, pp.jugador_id
  ),
  temp_mvp as (
    select j.temporada_id, m.jugador_id, count(*) as n
    from mvp_g m
    join jugados j on j.id = m.partido_id
    where j.temporada_id in (select id from cerradas)
    group by j.temporada_id, m.jugador_id
  )

  -- Acumulados (logro único)
  select t.jugador_id, u.id, null::bigint
  from tot t
  join (values
    ('primer_gol',  'g',  1),  ('goles_10',    'g', 10), ('goles_50',    'g', 50),
    ('asist_10',    'a', 10),
    ('debut',       'p',  1),  ('partidos_10', 'p', 10), ('partidos_50', 'p', 50)
  ) as u(id, campo, minimo)
    on (case u.campo when 'g' then t.g when 'a' then t.a else t.pj end) >= u.minimo

  union all
  -- Rachas
  select r.jugador_id, u.id, null::bigint
  from rachas r
  join (values ('racha_3', 3), ('racha_5', 5)) as u(id, minimo) on r.mx >= u.minimo

  union all
  -- MVP de partido
  select m.jugador_id, u.id, null::bigint
  from mvp_tot m
  join (values ('mvp_1', 1), ('mvp_5', 5)) as u(id, minimo) on m.n >= u.minimo

  union all
  -- Por partido (se pueden repetir)
  select pp.jugador_id, 'hat_trick', pp.partido_id from pp where pp.g >= 3
  union all
  select pp.jugador_id, 'poker', pp.partido_id from pp where pp.g >= 4
  union all
  select pp.jugador_id, 'asist_3', pp.partido_id from pp where pp.a >= 3
  union all
  select pp.jugador_id, 'goleada', pp.partido_id from pp where pp.gf - pp.gc >= 5
  union all
  select pp.jugador_id, 'todoterreno', pp.partido_id from pp where pp.g >= 1 and pp.a >= 1

  union all
  -- Por temporada cerrada
  select tj.jugador_id, 'asistencia_perfecta', tj.temporada_id
  from temp_j tj
  join partidos_temp pt on pt.temporada_id = tj.temporada_id
  where tj.pj = pt.n and pt.n >= 5

  union all
  select tj.jugador_id, 'pichichi', tj.temporada_id
  from temp_j tj
  where tj.g > 0
    and tj.g = (select max(x.g) from temp_j x where x.temporada_id = tj.temporada_id)

  union all
  select tj.jugador_id, 'asistente_temporada', tj.temporada_id
  from temp_j tj
  where tj.a > 0
    and tj.a = (select max(x.a) from temp_j x where x.temporada_id = tj.temporada_id)

  union all
  select tj.jugador_id, 'campeon_temporada', tj.temporada_id
  from temp_j tj
  where tj.w > 0
    and tj.w = (select max(x.w) from temp_j x where x.temporada_id = tj.temporada_id)

  union all
  select tm.jugador_id, 'mvp_temporada', tm.temporada_id
  from temp_mvp tm
  where tm.n = (select max(x.n) from temp_mvp x where x.temporada_id = tm.temporada_id)

  on conflict on constraint logros_jugador_unico do nothing;

  get diagnostics n = row_count;
  return n;
end;
$$;


revoke execute on function public.recalcular_logros() from public, anon, authenticated;
grant  execute on function public.recalcular_logros() to service_role;

-- ---------- Conceder los nuevos con lo ya jugado (sin avisos) ----------
do $$
begin
  perform set_config('app.sin_avisos', '1', true);
  perform public.recalcular_logros();
end;
$$;
