-- =====================================================================
-- GUMMI APP · Deshacer el script 19
-- =====================================================================
do $$ begin perform cron.unschedule(jobid) from cron.job where jobname = 'gummi-mantenimiento'; exception when others then null; end $$;
drop trigger if exists comentarios_avisar on public.comentarios;
drop trigger if exists partidos_avisar_borrado on public.partidos;
drop trigger if exists partidos_avisar_cambio on public.partidos;
drop function if exists public.avisos_comentario();
drop function if exists public.avisos_partido_borrado();
drop function if exists public.avisos_partido_cambio();
drop function if exists public.cerrar_votacion(bigint);
alter table public.perfiles drop column if exists bienvenida;

-- Mantenimiento como en el script 08
create or replace function public.mantenimiento(p_forzar boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ok boolean;
  r record;
  q record;
  v_ganadores text;
  v_horas integer;
  v_total integer := 0;
begin
  if auth.uid() is null then
    return 0;
  end if;

  update public.configuracion c
  set ultimo_mantenimiento = now()
  where c.id
    and (p_forzar or c.ultimo_mantenimiento is null or c.ultimo_mantenimiento < now() - interval '5 minutes')
  returning true into v_ok;

  if v_ok is not true then
    return 0;
  end if;

  -- 1) Logros nuevos
  v_total := v_total + public.recalcular_logros();

  -- 2) Resultado del MVP cuando acaba la votación
  for q in
    select p.id, p.fecha from public.partidos p
    where p.estado in ('jugado', 'cerrado')
      and not p.mvp_avisado
      and p.votacion_hasta is not null
      and p.votacion_hasta < now()
  loop
    select string_agg(coalesce(pr.apodo, pr.nombre), ' y ' order by pr.nombre)
    into v_ganadores
    from (
      select m.votado_id, count(*) as n,
             rank() over (order by count(*) desc) as pos
      from public.votos_mvp m
      where m.partido_id = q.id
      group by m.votado_id
    ) x
    join public.perfiles pr on pr.id = x.votado_id
    where x.pos = 1;

    if v_ganadores is not null then
      for r in select pa.jugador_id from public.participaciones pa where pa.partido_id = q.id loop
        perform public.avisar(r.jugador_id, 'mvp', '🏆 MVP del partido',
          'El MVP del partido del ' || to_char(q.fecha at time zone 'Europe/Madrid', 'DD/MM')
            || ' es ' || v_ganadores || '.',
          'partido', q.id, 'mvp:' || q.id);
        v_total := v_total + 1;
      end loop;
    end if;

    update public.partidos set mvp_avisado = true where id = q.id;
  end loop;

  -- 3) Recordatorio de votar (quedan menos de 12 h y no has votado nada)
  for q in
    select p.id, p.votacion_hasta from public.partidos p
    where p.estado = 'jugado'
      and p.votacion_hasta is not null
      and p.votacion_hasta > now()
      and p.votacion_hasta < now() + interval '12 hours'
  loop
    v_horas := greatest(1, ceil(extract(epoch from (q.votacion_hasta - now())) / 3600)::integer);
    for r in
      select pa.jugador_id from public.participaciones pa
      where pa.partido_id = q.id
        and not exists (select 1 from public.votos v where v.partido_id = q.id and v.votante_id = pa.jugador_id)
        and not exists (select 1 from public.votos_mvp m where m.partido_id = q.id and m.votante_id = pa.jugador_id)
    loop
      perform public.avisar(r.jugador_id, 'recordatorio_voto', 'Te queda poco para votar',
        'La votación del partido se cierra en unas ' || v_horas || ' h.', 'votar', q.id, 'recordv:' || q.id);
    end loop;
  end loop;

  -- 4) Recordatorio de convocatoria (falta menos de 24 h y no has respondido)
  for q in
    select p.id, p.fecha from public.partidos p
    where p.estado = 'convocatoria'
      and p.fecha > now()
      and p.fecha < now() + interval '24 hours'
  loop
    for r in
      select pr.id from public.perfiles pr
      where pr.user_id is not null and not pr.es_externo and pr.activo
        and not exists (select 1 from public.convocatorias c where c.partido_id = q.id and c.jugador_id = pr.id)
    loop
      perform public.avisar(r.id, 'recordatorio_convocatoria', '¿Vas al partido?',
        'El partido es el ' || to_char(q.fecha at time zone 'Europe/Madrid', 'DD/MM "a las" HH24:MI')
          || ' y todavía no has respondido.', 'partido', q.id, 'recordc:' || q.id);
    end loop;
  end loop;

  -- 5) Limpieza
  delete from public.notificaciones where created_at < now() - interval '60 days';

  return v_total;
end;
$$;


revoke execute on function public.mantenimiento(boolean) from public, anon;
grant  execute on function public.mantenimiento(boolean) to authenticated, service_role;
drop function if exists public.mantenimiento_interno(boolean);

-- "Equipos listos" como en el script 16
create or replace function public.avisos_partido_estado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_fecha text;
begin
  if new.estado is not distinct from old.estado then
    return new;
  end if;
  v_fecha := to_char(new.fecha at time zone 'Europe/Madrid', 'DD/MM "a las" HH24:MI');

  if new.estado = 'equipos' then
    for r in
      select pa.jugador_id from public.participaciones pa where pa.partido_id = new.id
    loop
      perform public.avisar(r.jugador_id, 'equipos', 'Equipos listos',
        'Ya están los equipos del partido del ' || v_fecha || '.', 'partido', new.id, 'equipos:' || new.id);
    end loop;

  elsif new.estado = 'jugado' then
    for r in
      select pa.jugador_id from public.participaciones pa where pa.partido_id = new.id
    loop
      perform public.avisar(r.jugador_id, 'jugado',
        'Partido cerrado' || case when new.goles_a is not null then ' (' || new.goles_a || '-' || new.goles_b || ')' else '' end,
        'Ya puedes votar a tus compañeros y elegir al MVP'
          || coalesce(' hasta el ' || to_char(new.votacion_hasta at time zone 'Europe/Madrid', 'DD/MM "a las" HH24:MI'), '') || '.',
        'votar', new.id, 'jugado:' || new.id);
    end loop;
  end if;
  return new;
end;
$$;
