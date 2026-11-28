-- =====================================================================
-- GUMMI APP · Script 23: la nota del admin pesa en la media de partida
-- Ejecutar DESPUÉS de los scripts anteriores.
--   * Media de partida = 50 % tu nota (Plantilla > ⋯) + 50 % la media de la
--     votación inicial. Si solo hay una de las dos, se usa esa.
--   * Después, cada partido la sigue moviendo poco a poco como hasta ahora.
-- Para deshacerlo: 23_nota_admin_down.sql
-- Se puede ejecutar más de una vez.
-- =====================================================================

create or replace function public.notas_jugadores()
returns table (
  jugador_id uuid,
  nota       numeric,   -- media actual 0-99
  num_votos  integer,   -- votos recibidos en total
  fuente     text,      -- votos | manual | sin_nota
  nota_votos numeric,   -- media de partida (votación inicial o manual)
  ajuste     numeric    -- cuánto se ha movido desde la media de partida
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  k      constant numeric := 0.06;   -- cuánto se mueve la media por partido
  v_base jsonb := '{}'::jsonb;
  v_med  jsonb := '{}'::jsonb;
  r      record;
  actual numeric;
  obj    numeric;
  esp    numeric;
  ofe    numeric;
  extra  numeric;
begin
  if not public.es_admin() then
    raise exception 'Las medias son privadas';
  end if;

  -- 1) Media de partida
  for r in
    select pr.id,
           (select avg(x.nota)
            from (
              select v.nota,
                     row_number() over (order by v.nota, v.id)      as ra,
                     row_number() over (order by v.nota desc, v.id) as rd,
                     count(*)     over ()                           as n
              from public.votos v
              where v.votado_id = pr.id and v.partido_id is null
            ) x
            where x.n < 5 or (x.ra > 1 and x.rd > 1)) * 10 as ini,
           nm.nota as manual
    from public.perfiles pr
    left join public.notas_manuales nm on nm.jugador_id = pr.id
    where pr.activo
  loop
    if r.ini is not null and r.manual is not null then
      -- Base = 50 % la nota del admin + 50 % la votación inicial
      v_base := v_base || jsonb_build_object(r.id::text, 0.5 * r.manual + 0.5 * r.ini);
      v_med  := v_med  || jsonb_build_object(r.id::text, 0.5 * r.manual + 0.5 * r.ini);
    elsif r.ini is not null then
      v_base := v_base || jsonb_build_object(r.id::text, r.ini);
      v_med  := v_med  || jsonb_build_object(r.id::text, r.ini);
    elsif r.manual is not null then
      v_base := v_base || jsonb_build_object(r.id::text, r.manual);
      v_med  := v_med  || jsonb_build_object(r.id::text, r.manual);
    end if;
  end loop;

  -- 2) Partidos con la votación terminada, en orden
  for r in
    with jugados as (
      select p.id, p.fecha, p.goles_a, p.goles_b
      from public.partidos p
      where p.estado in ('jugado', 'cerrado')
        and p.goles_a is not null and p.goles_b is not null
        and p.votacion_hasta is not null and p.votacion_hasta < now()
    ),
    mvp_g as (
      select x.partido_id, x.votado_id as jugador_id
      from (
        select m.partido_id, m.votado_id,
               rank() over (partition by m.partido_id order by count(*) desc) as pos
        from public.votos_mvp m
        join jugados j on j.id = m.partido_id
        group by m.partido_id, m.votado_id
      ) x
      where x.pos = 1
    ),
    ev as (
      select e.partido_id, e.jugador_id, count(*) as ga
      from public.eventos e
      group by e.partido_id, e.jugador_id
    )
    select pa.jugador_id, j.id as partido, pr.posicion,
           (select avg(x.nota)
            from (
              select v.nota,
                     row_number() over (order by v.nota, v.id)      as ra,
                     row_number() over (order by v.nota desc, v.id) as rd,
                     count(*)     over ()                           as n
              from public.votos v
              where v.votado_id = pa.jugador_id and v.partido_id = j.id
            ) x
            where x.n < 5 or (x.ra > 1 and x.rd > 1)) as voto,
           coalesce(ev.ga, 0) as ga,
           case
             when (pa.equipo = 'A' and j.goles_a > j.goles_b) or (pa.equipo = 'B' and j.goles_b > j.goles_a) then 1
             when (pa.equipo = 'A' and j.goles_a < j.goles_b) or (pa.equipo = 'B' and j.goles_b < j.goles_a) then -1
             else 0
           end as res,
           (mg.jugador_id is not null) as es_mvp
    from public.participaciones pa
    join jugados j on j.id = pa.partido_id
    join public.perfiles pr on pr.id = pa.jugador_id
    left join ev   on ev.partido_id = j.id and ev.jugador_id = pa.jugador_id
    left join mvp_g mg on mg.partido_id = j.id and mg.jugador_id = pa.jugador_id
    order by j.fecha, j.id
  loop
    continue when r.voto is null;   -- sin votos en ese partido no se mueve nada

    obj := r.voto * 10;
    actual := (v_med ->> r.jugador_id::text)::numeric;
    if actual is null then
      actual := obj;                 -- primera referencia
    end if;

    esp := case r.posicion::text when 'defensa' then 0.5 when 'medio' then 0.8
                                 when 'banda' then 1.0 when 'delantero' then 1.2 else 0.8 end;
    ofe := case when r.posicion::text = 'portero' then 0
                else greatest(-1, least(1, (r.ga - esp) / (esp + 0.6))) end;
    extra := 0.5 * (0.4 * ofe + 0.3 * (case when r.es_mvp then 1 else 0 end) + 0.3 * r.res);

    actual := greatest(0, least(99, actual + k * (obj - actual) + extra));
    v_med := v_med || jsonb_build_object(r.jugador_id::text, actual);
  end loop;

  -- 3) Resultado
  for r in
    select pr.id,
           (select count(*) from public.votos v where v.votado_id = pr.id)::integer as nv,
           (select 1 from public.notas_manuales nm where nm.jugador_id = pr.id) as hay_manual
    from public.perfiles pr
    where pr.activo
  loop
    jugador_id := r.id;
    num_votos  := r.nv;
    nota_votos := (v_base ->> r.id::text)::numeric;
    nota       := (v_med  ->> r.id::text)::numeric;
    if nota is not null then nota := round(nota, 1); end if;
    ajuste := case when nota is null or nota_votos is null then 0 else round(nota - nota_votos, 1) end;
    fuente := case
                when nota is null then 'sin_nota'
                when r.nv > 0 and r.hay_manual is not null then 'mixta'
                when r.nv > 0 then 'votos'
                when r.hay_manual is not null then 'manual'
                else 'votos' end;
    return next;
  end loop;
end;
$$;


revoke execute on function public.notas_jugadores() from public, anon;
grant  execute on function public.notas_jugadores() to authenticated, service_role;
