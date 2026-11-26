-- =====================================================================
-- GUMMI APP · Script 15: avisos al móvil (con la app cerrada)
-- Ejecutar DESPUÉS de los scripts 1 a 6 y 8 a 14.
-- Pegar entero en Supabase > SQL Editor > New query > Run
--
-- Qué hace:
--   * Guarda en qué móviles ha activado cada jugador los avisos.
--   * Cada vez que la app crea un aviso (partido nuevo, equipos, votación,
--     logros, recordatorios…), avisa a la función "enviar-push", que lo
--     manda al móvil aunque la app esté cerrada.
--   * Si la función todavía no está configurada, no pasa nada: los avisos
--     siguen saliendo dentro de la app como hasta ahora.
-- Se puede ejecutar más de una vez.
-- =====================================================================

-- pg_net permite a la base de datos llamar a la función sin esperar respuesta
create extension if not exists pg_net;

-- ---------- Móviles con avisos activados ----------
create table if not exists public.suscripciones_push (
  id          bigint generated always as identity primary key,
  usuario_id  uuid not null references public.perfiles (id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  dispositivo text,
  created_at  timestamptz not null default now()
);
create index if not exists suscripciones_push_usuario_idx on public.suscripciones_push (usuario_id);

alter table public.suscripciones_push enable row level security;
drop policy if exists "push: ver las propias" on public.suscripciones_push;
create policy "push: ver las propias" on public.suscripciones_push
  for select to authenticated using (usuario_id = public.mi_perfil_id());
revoke all on public.suscripciones_push from anon, authenticated;
grant select on public.suscripciones_push to authenticated;
grant select, insert, update, delete on public.suscripciones_push to service_role;

-- ---------- Configuración (solo la ve el servidor) ----------
create table if not exists public.push_config (
  id      boolean primary key default true check (id),
  url     text,   -- dirección de la función enviar-push
  secreto text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
insert into public.push_config (id) values (true) on conflict (id) do nothing;
alter table public.push_config enable row level security;
revoke all on public.push_config from anon, authenticated;
grant select, update on public.push_config to service_role;

-- ---------- Activar / desactivar avisos en este móvil ----------
create or replace function public.guardar_suscripcion(p_endpoint text, p_p256dh text, p_auth text, p_dispositivo text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_yo uuid := public.mi_perfil_id();
begin
  if v_yo is null then
    raise exception 'Sin perfil';
  end if;
  -- Si este móvil estaba a nombre de otro (cambio de cuenta), pasa a ser tuyo
  delete from public.suscripciones_push where endpoint = p_endpoint;
  insert into public.suscripciones_push (usuario_id, endpoint, p256dh, auth, dispositivo)
  values (v_yo, p_endpoint, p_p256dh, p_auth, left(p_dispositivo, 120));
end;
$$;

create or replace function public.quitar_suscripcion(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.suscripciones_push
  where endpoint = p_endpoint and usuario_id = public.mi_perfil_id();
$$;

-- Aviso de prueba para uno mismo
create or replace function public.probar_push()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_yo uuid := public.mi_perfil_id();
begin
  if v_yo is null then
    raise exception 'Sin perfil';
  end if;
  insert into public.notificaciones (usuario_id, tipo, titulo, cuerpo, destino, ref, clave)
  values (v_yo, 'prueba', '🔔 Prueba de avisos', 'Si ves esto en el móvil, los avisos funcionan.', null, null, null);
end;
$$;

-- Solo admin: dirección de la función (la app la rellena sola con un botón)
create or replace function public.configurar_push(p_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un admin';
  end if;
  update public.push_config set url = nullif(trim(p_url), '') where id;
end;
$$;

-- Solo admin: cuántos tienen los avisos activados
create or replace function public.resumen_push()
returns table (configurado boolean, jugadores integer, moviles integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un admin';
  end if;
  return query
  select (select url is not null from public.push_config where id),
         (select count(distinct usuario_id)::integer from public.suscripciones_push),
         (select count(*)::integer from public.suscripciones_push);
end;
$$;

revoke execute on function public.guardar_suscripcion(text, text, text, text) from public, anon;
revoke execute on function public.quitar_suscripcion(text) from public, anon;
revoke execute on function public.probar_push() from public, anon;
revoke execute on function public.configurar_push(text) from public, anon;
revoke execute on function public.resumen_push() from public, anon;
grant execute on function public.guardar_suscripcion(text, text, text, text) to authenticated;
grant execute on function public.quitar_suscripcion(text) to authenticated;
grant execute on function public.probar_push() to authenticated;
grant execute on function public.configurar_push(text) to authenticated;
grant execute on function public.resumen_push() to authenticated;

-- ---------- Envío: cada tanda de avisos nuevos llama a la función ----------
create or replace function public.push_enviar_nuevas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_sec text;
  v_ids bigint[];
begin
  select url, secreto into v_url, v_sec from public.push_config where id;
  if v_url is null then
    return null;
  end if;
  select array_agg(n.id) into v_ids
  from nuevas n
  where exists (select 1 from public.suscripciones_push s where s.usuario_id = n.usuario_id);
  if v_ids is null then
    return null;
  end if;
  perform net.http_post(
    url     := v_url,
    body    := jsonb_build_object('ids', to_jsonb(v_ids)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-gummi-secreto', v_sec),
    timeout_milliseconds := 10000
  );
  return null;
exception when others then
  -- Un fallo al avisar al móvil nunca debe impedir que se guarde el aviso
  raise warning 'avisos push: %', sqlerrm;
  return null;
end;
$$;

drop trigger if exists notificaciones_push on public.notificaciones;
create trigger notificaciones_push
  after insert on public.notificaciones
  referencing new table as nuevas
  for each statement execute function public.push_enviar_nuevas();
