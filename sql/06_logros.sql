-- =====================================================================
-- GUMMI APP · Script 6: logros
-- Ejecutar DESPUÉS de los scripts 1 a 5.
-- Pegar entero en Supabase > SQL Editor > New query > Run
--
-- Qué hace:
--   * Crea el catálogo de logros y la tabla de quién tiene cada uno.
--   * recalcular_logros(): revisa todos los partidos jugados y concede los
--     logros que correspondan (no quita ninguno ni repite los ya dados).
--     La app lo llama sola al cerrar un partido.
--   * reiniciar_logros(): solo admin. Borra todos los logros y los vuelve a
--     calcular desde cero (útil si corriges un resultado antiguo).
--   * Al final calcula los logros de los partidos que ya tengas.
--
-- Se puede ejecutar más de una vez.
-- =====================================================================

create table if not exists public.logros (
  id          text primary key,
  nombre      text not null,
  descripcion text not null,
  icono       text not null,
  repetible   boolean not null default false,
  orden       integer not null default 0
);

create table if not exists public.logros_jugador (
  id          bigint generated always as identity primary key,
  jugador_id  uuid   not null references public.perfiles (id) on delete cascade,
  logro_id    text   not null references public.logros (id) on delete cascade,
  ref         bigint,                       -- partido o temporada de la que viene (null = logro único)
  obtenido_en timestamptz not null default now(),
  constraint logros_jugador_unico unique nulls not distinct (jugador_id, logro_id, ref)
);

create index if not exists logros_jugador_jugador_idx on public.logros_jugador (jugador_id);

alter table public.logros          enable row level security;
alter table public.logros_jugador  enable row level security;

drop policy if exists "logros: todos leen" on public.logros;
create policy "logros: todos leen" on public.logros
  for select to authenticated using (true);

drop policy if exists "logros_jugador: todos leen" on public.logros_jugador;
create policy "logros_jugador: todos leen" on public.logros_jugador
  for select to authenticated using (true);

grant select on public.logros         to authenticated;
grant select on public.logros_jugador to authenticated;
grant select, insert, update, delete on public.logros         to service_role;
grant select, insert, update, delete on public.logros_jugador to service_role;

-- ---------- Catálogo ----------
insert into public.logros (id, nombre, descripcion, icono, repetible, orden) values
  ('primer_gol',          'Primer gol',          'Marca tu primer gol',                               '⚽', false, 10),
  ('goles_10',            '10 goles',            'Llega a 10 goles en total',                         '🎯', false, 11),
  ('goles_25',            '25 goles',            'Llega a 25 goles en total',                         '🎯', false, 12),
  ('goles_50',            '50 goles',            'Llega a 50 goles en total',                         '🚀', false, 13),
  ('asist_10',            '10 asistencias',      'Llega a 10 asistencias en total',                   '🅰️', false, 20),
  ('asist_25',            '25 asistencias',      'Llega a 25 asistencias en total',                   '🅰️', false, 21),
  ('partidos_10',         '10 partidos',         'Juega 10 partidos',                                 '👟', false, 30),
  ('partidos_25',         '25 partidos',         'Juega 25 partidos',                                 '👟', false, 31),
  ('partidos_50',         '50 partidos',         'Juega 50 partidos',                                 '🏅', false, 32),
  ('hat_trick',           'Hat-trick',           '3 goles o más en un mismo partido',                 '🎩', true,  40),
  ('poker',               'Póker',               '4 goles o más en un mismo partido',                 '🃏', true,  41),
  ('asist_3',             'Repartidor',          '3 asistencias o más en un mismo partido',           '🎁', true,  42),
  ('goleada',             'Goleada',             'Gana un partido por 5 goles o más de diferencia',   '💥', true,  43),
  ('muro',                'Muro',                'Portero que no encaja ningún gol en un partido',    '🧱', true,  44),
  ('racha_3',             'En racha',            '3 victorias seguidas',                              '🔥', false, 50),
  ('racha_5',             'Imparable',           '5 victorias seguidas',                              '🔥', false, 51),
  ('mvp_1',               'Primer MVP',          'Sé el MVP de un partido',                           '🏆', false, 60),
  ('mvp_3',               'MVP x3',              'Sé MVP en 3 partidos',                              '🏆', false, 61),
  ('mvp_5',               'MVP x5',              'Sé MVP en 5 partidos',                              '👑', false, 62),
  ('asistencia_perfecta', 'Asistencia perfecta', 'No faltar a ningún partido de una temporada (mínimo 5)', '📅', true, 70),
  ('pichichi',            'Pichichi',            'Máximo goleador de una temporada',                  '👑', true,  71),
  ('asistente_temporada', 'Mejor asistente',     'Máximo asistente de una temporada',                 '🤝', true,  72),
  ('mvp_temporada',       'MVP de la temporada', 'Más MVP de una temporada',                          '⭐', true,  73),
  ('campeon_temporada',   'Campeón',             'Más victorias de una temporada',                    '🥇', true,  74)
on conflict (id) do update
  set nombre = excluded.nombre,
      descripcion = excluded.descripcion,
      icono = excluded.icono,
      repetible = excluded.repetible,
      orden = excluded.orden;

-- ---------- Cálculo ----------
-- Concede los logros que falten. Devuelve cuántos nuevos ha concedido.
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
    ('primer_gol',  'g',  1),  ('goles_10',    'g', 10), ('goles_25',    'g', 25), ('goles_50',    'g', 50),
    ('asist_10',    'a', 10),  ('asist_25',    'a', 25),
    ('partidos_10', 'p', 10),  ('partidos_25', 'p', 25), ('partidos_50', 'p', 50)
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
  join (values ('mvp_1', 1), ('mvp_3', 3), ('mvp_5', 5)) as u(id, minimo) on m.n >= u.minimo

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
  select pp.jugador_id, 'muro', pp.partido_id from pp where pp.posicion = 'portero' and pp.gc = 0

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

-- ---------- Borrar y recalcular todo (solo admin) ----------
create or replace function public.reiniciar_logros()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if not public.es_admin() then
    raise exception 'Solo un admin puede reiniciar los logros';
  end if;
  perform set_config('app.sin_avisos', '1', true);   -- sin avisos de logros antiguos
  delete from public.logros_jugador;
  n := public.recalcular_logros();
  return n;
end;
$$;

revoke execute on function public.reiniciar_logros() from public, anon;
grant  execute on function public.reiniciar_logros() to authenticated, service_role;

-- ---------- Logros de lo que ya está jugado (sin avisos) ----------
do $$
begin
  perform set_config('app.sin_avisos', '1', true);
  perform public.recalcular_logros();
end;
$$;
