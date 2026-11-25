-- =====================================================================
-- GUMMI APP · Script 8: avisos (notificaciones dentro de la app)
-- Ejecutar DESPUÉS de los scripts 1 a 7.
-- Pegar entero en Supabase > SQL Editor > New query > Run
--
-- Qué hace:
--   * Crea la bandeja de avisos de cada jugador (la campana de la app).
--   * Avisos automáticos:
--       - Partido nuevo creado
--       - Equipos listos (a los que han dicho "voy")
--       - Partido cerrado: ya se puede votar (a los que jugaron)
--       - Se abre la votación inicial
--       - Has conseguido un logro
--       - Resultado del MVP al terminar la votación
--       - Recordatorio de votar (quedan menos de 12 h)
--       - Recordatorio de responder si vas a un partido (falta menos de 24 h)
--   * mantenimiento(): lo ejecuta la propia app cada poco. Concede logros,
--     lanza los avisos "por tiempo" y borra avisos de más de 60 días.
--
-- Los avisos solo llegan a quien tiene cuenta (no a los externos).
-- Se puede ejecutar más de una vez.
-- =====================================================================

alter table public.partidos       add column if not exists mvp_avisado boolean not null default false;
alter table public.configuracion  add column if not exists ultimo_mantenimiento timestamptz;

-- Lo que ya terminó antes de instalar esto no genera aviso de MVP.
update public.partidos
set mvp_avisado = true
where not mvp_avisado
  and (votacion_hasta is null or votacion_hasta < now());

-- ---------- Tabla ----------
create table if not exists public.notificaciones (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references public.perfiles (id) on delete cascade,
  tipo        text not null,
  titulo      text not null,
  cuerpo      text,
  destino     text,            -- partido | votar | logros | ranking
  ref         bigint,
  clave       text,            -- evita avisos duplicados
  leida       boolean not null default false,
  created_at  timestamptz not null default now()
);

create unique index if not exists notificaciones_clave_idx
  on public.notificaciones (usuario_id, clave) where clave is not null;
create index if not exists notificaciones_usuario_idx
  on public.notificaciones (usuario_id, created_at desc);

alter table public.notificaciones enable row level security;

drop policy if exists "avisos: ver los propios" on public.notificaciones;
create policy "avisos: ver los propios" on public.notificaciones
  for select to authenticated using (usuario_id = public.mi_perfil_id());

drop policy if exists "avisos: marcar los propios" on public.notificaciones;
create policy "avisos: marcar los propios" on public.notificaciones
  for update to authenticated
  using (usuario_id = public.mi_perfil_id())
  with check (usuario_id = public.mi_perfil_id());

drop policy if exists "avisos: borrar los propios" on public.notificaciones;
create policy "avisos: borrar los propios" on public.notificaciones
  for delete to authenticated using (usuario_id = public.mi_perfil_id());

grant select, delete on public.notificaciones to authenticated;
grant update (leida) on public.notificaciones to authenticated;
grant select, insert, update, delete on public.notificaciones to service_role;

-- ---------- Enviar un aviso (interno) ----------
create or replace function public.avisar(
  p_usuario uuid, p_tipo text, p_titulo text, p_cuerpo text,
  p_destino text, p_ref bigint, p_clave text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.sin_avisos', true), '') = '1' then
    return;
  end if;
  insert into public.notificaciones (usuario_id, tipo, titulo, cuerpo, destino, ref, clave)
  select pr.id, p_tipo, p_titulo, p_cuerpo, p_destino, p_ref, p_clave
  from public.perfiles pr
  where pr.id = p_usuario and pr.user_id is not null and not pr.es_externo and pr.activo
  on conflict (usuario_id, clave) where clave is not null do nothing;
end;
$$;

revoke execute on function public.avisar(uuid, text, text, text, text, bigint, text) from public, anon, authenticated;

-- ---------- Disparadores ----------
-- Partido nuevo
create or replace function public.avisos_partido_nuevo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_cuerpo text;
begin
  v_cuerpo := to_char(new.fecha at time zone 'Europe/Madrid', 'DD/MM "a las" HH24:MI')
              || coalesce(' · ' || new.lugar, '') || '. ¡Confirma si vas!';
  for r in
    select pr.id from public.perfiles pr
    where pr.user_id is not null and not pr.es_externo and pr.activo
      and pr.id is distinct from new.creado_por
  loop
    perform public.avisar(r.id, 'partido_nuevo', 'Nuevo partido', v_cuerpo, 'partido', new.id, 'nuevo:' || new.id);
  end loop;
  return new;
end;
$$;

drop trigger if exists partidos_avisar_nuevo on public.partidos;
create trigger partidos_avisar_nuevo
  after insert on public.partidos
  for each row execute function public.avisos_partido_nuevo();

-- Cambios de estado: equipos listos / partido cerrado
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
      select c.jugador_id from public.convocatorias c
      where c.partido_id = new.id and c.respuesta = 'voy'
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

drop trigger if exists partidos_avisar_estado on public.partidos;
create trigger partidos_avisar_estado
  after update of estado on public.partidos
  for each row execute function public.avisos_partido_estado();

-- Se abre la votación inicial
create or replace function public.avisos_votacion_inicial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  if new.votacion_inicial_abierta and not old.votacion_inicial_abierta then
    for r in
      select pr.id from public.perfiles pr
      where pr.user_id is not null and not pr.es_externo and pr.activo
    loop
      perform public.avisar(r.id, 'votacion_inicial', 'Votación inicial abierta',
        'Puntúa a tus compañeros del 1 al 10.', 'votar', null,
        'vi:' || extract(epoch from now())::bigint);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists configuracion_avisar_vi on public.configuracion;
create trigger configuracion_avisar_vi
  after update of votacion_inicial_abierta on public.configuracion
  for each row execute function public.avisos_votacion_inicial();

-- Logro conseguido
create or replace function public.avisos_logro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  l record;
begin
  select * into l from public.logros where id = new.logro_id;
  if found then
    perform public.avisar(new.jugador_id, 'logro', l.icono || ' Logro: ' || l.nombre, l.descripcion,
                          'logros', null, 'logro:' || new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists logros_avisar on public.logros_jugador;
create trigger logros_avisar
  after insert on public.logros_jugador
  for each row execute function public.avisos_logro();

-- ---------- Mantenimiento (la app lo llama sola) ----------
-- Concede logros, lanza avisos por tiempo y limpia avisos viejos.
-- Si se ejecuta varias veces seguidas solo trabaja una vez cada 5 minutos,
-- salvo que se pida forzarlo (al cerrar un partido).
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
