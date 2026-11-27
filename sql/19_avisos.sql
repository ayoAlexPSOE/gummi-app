-- =====================================================================
-- GUMMI APP · Script 19: avisos completos + bienvenida
-- Ejecutar DESPUÉS de los scripts 1 a 6 y 8 a 18.
-- Pegar entero en Supabase > SQL Editor > New query > Run
--
-- Avisos nuevos (llegan al móvil igual que los demás):
--   * ⏳ "¡Quedan pocas plazas!" a quien no ha respondido (cuando faltan 3 o menos).
--   * ⚽ "Hoy hay partido" unas 3 h antes, a los que juegan.
--   * 👑 "¡Eres el MVP!" al ganador (los demás reciben quién ha sido).
--   * 🕒 "Cambio en el partido" si el admin cambia la hora o el lugar.
--   * ❌ "Partido cancelado" si el admin borra un partido.
--   * 💬 "X ha comentado el partido" a los que jugaron (como mucho uno cada 2 h).
--   * 🔒 Votación cerrada antes de tiempo (botón nuevo del admin).
--   * "Equipos listos" ahora dice con qué camiseta juegas.
-- Además:
--   * Los recordatorios salen solos cada 10 minutos aunque nadie tenga la app
--     abierta (tarea programada "gummi-mantenimiento").
--   * Columna "bienvenida" en perfiles: la primera vez que alguien entra, la app
--     le guía para poner su contraseña, nombre, foto y posición.
-- Para deshacerlo: 19_avisos_down.sql
-- Se puede ejecutar más de una vez.
-- =====================================================================

-- ---------- Bienvenida del primer acceso ----------
alter table public.perfiles add column if not exists bienvenida timestamptz;
update public.perfiles set bienvenida = now() where bienvenida is null and user_id is not null;   -- los de ahora ya están dentro
grant update (bienvenida) on public.perfiles to authenticated;

-- ---------- Mantenimiento (recordatorios, MVP, logros) ----------
create or replace function public.mantenimiento_interno(p_forzar boolean default false)
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
  v_plazas integer;
  v_van integer;
  v_mvp uuid[];
begin
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

    select array_agg(x.votado_id) into v_mvp
    from (
      select m.votado_id, rank() over (order by count(*) desc) as pos
      from public.votos_mvp m where m.partido_id = q.id group by m.votado_id
    ) x where x.pos = 1;

    if v_ganadores is not null then
      -- Al ganador, uno especial (misma clave: así no recibe también el general)
      for r in select unnest(v_mvp) as jugador_id loop
        perform public.avisar(r.jugador_id, 'mvp', '👑 ¡Eres el MVP!',
          'Tus compañeros te han votado MVP del partido del ' || to_char(q.fecha at time zone 'Europe/Madrid', 'DD/MM') || '. ¡Crack!',
          'partido', q.id, 'mvp:' || q.id);
      end loop;
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

  -- 4b) Quedan pocas plazas: a los que no han respondido, una vez por partido
  select coalesce(c.plazas, 14) into v_plazas from public.configuracion c where c.id;
  for q in
    select p.id, p.fecha from public.partidos p
    where p.estado = 'convocatoria' and p.fecha > now()
  loop
    select count(*) into v_van from public.convocatorias c where c.partido_id = q.id and c.respuesta = 'voy';
    if v_van >= v_plazas - 3 and v_van < v_plazas then
      for r in
        select pr.id from public.perfiles pr
        where pr.user_id is not null and not pr.es_externo and pr.activo
          and not exists (select 1 from public.convocatorias c where c.partido_id = q.id and c.jugador_id = pr.id and c.respuesta in ('voy', 'no_voy'))
      loop
        perform public.avisar(r.id, 'pocas_plazas', '⏳ ¡Quedan ' || (v_plazas - v_van) || ' plazas!',
          'Partido del ' || to_char(q.fecha at time zone 'Europe/Madrid', 'DD/MM "a las" HH24:MI') || '. Apúntate antes de quedarte de reserva.',
          'partido', q.id, 'pocas:' || q.id);
      end loop;
    end if;
  end loop;

  -- 4c) Hoy juegas: unas 3 h antes, a los que juegan
  for q in
    select p.id, p.fecha, p.lugar, p.estado from public.partidos p
    where p.estado in ('convocatoria', 'equipos')
      and p.fecha > now() and p.fecha < now() + interval '3 hours'
  loop
    for r in
      select x.jugador_id from (
        select c.jugador_id, row_number() over (order by coalesce(c.voy_desde, c.updated_at), c.jugador_id) as n
        from public.convocatorias c where c.partido_id = q.id and c.respuesta = 'voy'
      ) x where x.n <= v_plazas
    loop
      perform public.avisar(r.jugador_id, 'hoy', '⚽ Hoy hay partido',
        'A las ' || to_char(q.fecha at time zone 'Europe/Madrid', 'HH24:MI') || coalesce(' en ' || nullif(q.lugar, ''), '') || '. ¡No llegues tarde!',
        'partido', q.id, 'hoy:' || q.id);
    end loop;
  end loop;

  -- 5) Limpieza
  delete from public.notificaciones where created_at < now() - interval '60 days';

  return v_total;
end;
$$;


revoke execute on function public.mantenimiento_interno(boolean) from public, anon, authenticated;
grant  execute on function public.mantenimiento_interno(boolean) to service_role;

-- La app lo sigue llamando igual (solo con sesión iniciada)
create or replace function public.mantenimiento(p_forzar boolean default false)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return 0;
  end if;
  return public.mantenimiento_interno(p_forzar);
end;
$$;
revoke execute on function public.mantenimiento(boolean) from public, anon;
grant  execute on function public.mantenimiento(boolean) to authenticated, service_role;

-- ---------- Cerrar la votación ya (solo admin) ----------
create or replace function public.cerrar_votacion(p_partido bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un admin';
  end if;
  update public.partidos set votacion_hasta = now() - interval '1 second'
  where id = p_partido and estado = 'jugado' and votacion_hasta > now();
  perform public.mantenimiento_interno(true);   -- sale ya el aviso del MVP
end;
$$;
revoke execute on function public.cerrar_votacion(bigint) from public, anon;
grant  execute on function public.cerrar_votacion(bigint) to authenticated;

-- ---------- Equipos listos (con la camiseta) y partido cerrado ----------
create or replace function public.avisos_partido_estado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_fecha text;
  v_color text;
begin
  if new.estado is not distinct from old.estado then
    return new;
  end if;
  v_fecha := to_char(new.fecha at time zone 'Europe/Madrid', 'DD/MM "a las" HH24:MI');

  if new.estado = 'equipos' then
    for r in select pa.jugador_id, pa.equipo from public.participaciones pa where pa.partido_id = new.id loop
      v_color := case when r.equipo = 'A' then new.color_a else new.color_b end;
      perform public.avisar(r.jugador_id, 'equipos', '👕 Equipos listos',
        case when v_color is not null
          then 'Partido del ' || v_fecha || ': juegas de ' || v_color || '. ¡Lleva la camiseta ' || v_color || '!'
          else 'Ya están los equipos del partido del ' || v_fecha || ': juegas en el equipo ' || r.equipo || '.' end,
        'partido', new.id, 'equipos:' || new.id);
    end loop;

  elsif new.estado = 'jugado' then
    for r in select pa.jugador_id from public.participaciones pa where pa.partido_id = new.id loop
      perform public.avisar(r.jugador_id, 'jugado',
        '🗳️ A votar' || case when new.goles_a is not null then ' (' || new.goles_a || '-' || new.goles_b || ')' else '' end,
        'Pon nota a tus compañeros y elige al MVP'
          || coalesce(' hasta el ' || to_char(new.votacion_hasta at time zone 'Europe/Madrid', 'DD/MM "a las" HH24:MI'), '') || '.',
        'votar', new.id, 'jugado:' || new.id);
    end loop;
  end if;
  return new;
end;
$$;

-- ---------- Cambio de hora o lugar ----------
create or replace function public.avisos_partido_cambio()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if new.estado not in ('convocatoria', 'equipos') or new.fecha < now() then
    return new;
  end if;
  if new.fecha is not distinct from old.fecha and new.lugar is not distinct from old.lugar then
    return new;
  end if;
  for r in select c.jugador_id from public.convocatorias c where c.partido_id = new.id and c.respuesta in ('voy', 'duda') loop
    perform public.avisar(r.jugador_id, 'cambio', '🕒 Cambio en el partido',
      'Ahora es el ' || to_char(new.fecha at time zone 'Europe/Madrid', 'DD/MM "a las" HH24:MI') || coalesce(' en ' || nullif(new.lugar, ''), '') || '.',
      'partido', new.id, 'cambio:' || new.id || ':' || extract(epoch from now())::bigint);
  end loop;
  return new;
end;
$$;
drop trigger if exists partidos_avisar_cambio on public.partidos;
create trigger partidos_avisar_cambio
  after update of fecha, lugar on public.partidos
  for each row execute function public.avisos_partido_cambio();

-- ---------- Partido cancelado (borrado) ----------
create or replace function public.avisos_partido_borrado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if old.estado not in ('convocatoria', 'equipos') or old.fecha < now() then
    return old;
  end if;
  for r in select c.jugador_id from public.convocatorias c where c.partido_id = old.id and c.respuesta in ('voy', 'duda') loop
    perform public.avisar(r.jugador_id, 'cancelado', '❌ Partido cancelado',
      'Se ha cancelado el partido del ' || to_char(old.fecha at time zone 'Europe/Madrid', 'DD/MM "a las" HH24:MI') || '.',
      null, null, 'cancelado:' || old.id);
  end loop;
  return old;
end;
$$;
drop trigger if exists partidos_avisar_borrado on public.partidos;
create trigger partidos_avisar_borrado
  before delete on public.partidos
  for each row execute function public.avisos_partido_borrado();

-- ---------- Comentarios ----------
create or replace function public.avisos_comentario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_autor text;
begin
  select coalesce(apodo, nombre) into v_autor from public.perfiles where id = new.autor_id;
  for r in select pa.jugador_id from public.participaciones pa where pa.partido_id = new.partido_id and pa.jugador_id <> new.autor_id loop
    perform public.avisar(r.jugador_id, 'comentario', '💬 ' || coalesce(v_autor, 'Alguien') || ' ha comentado el partido',
      left(new.texto, 120), 'partido', new.partido_id,
      'coment:' || new.partido_id || ':' || floor(extract(epoch from now()) / 7200)::bigint);
  end loop;
  return null;
end;
$$;
drop trigger if exists comentarios_avisar on public.comentarios;
create trigger comentarios_avisar
  after insert on public.comentarios
  for each row execute function public.avisos_comentario();

-- ---------- Tarea programada: cada 10 minutos ----------
-- Si pg_cron no está disponible, todo lo demás funciona igual (los recordatorios
-- saldrán cuando alguien abra la app, como hasta ahora).
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'gummi-mantenimiento';
  perform cron.schedule('gummi-mantenimiento', '*/10 * * * *', 'select public.mantenimiento_interno(false)');
exception when others then
  raise notice 'Tarea programada no creada (%). Activa "Cron" en Supabase > Integrations y vuelve a ejecutar.', sqlerrm;
end;
$$;
