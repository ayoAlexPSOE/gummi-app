-- =====================================================================
-- GUMMI APP · Script 16: lista de reservas
-- Ejecutar DESPUÉS de los scripts 1 a 6 y 8 a 15.
-- Pegar entero en Supabase > SQL Editor > New query > Run
--
-- Qué hace (solo AÑADE cosas, no borra nada):
--   * Número de plazas por partido (por defecto 14, fútbol 7). El admin lo
--     cambia desde la app.
--   * Guarda desde cuándo dice "Voy" cada uno: los primeros en apuntarse
--     juegan y los demás quedan de reserva, por orden de llegada.
--     (Volver a pulsar "Voy" no te hace perder el sitio.)
--   * Si un titular se borra, el primer reserva entra solo y le llega un
--     aviso: "¡Entras al partido!".
--   * El aviso de "Equipos listos" llega solo a los que juegan
--     (antes llegaba a todos los que dijeron "Voy", reservas incluidos).
-- Para deshacerlo: 16_reservas_down.sql
-- Se puede ejecutar más de una vez.
-- =====================================================================

-- ---------- Plazas ----------
alter table public.configuracion add column if not exists plazas smallint not null default 14;
alter table public.configuracion drop constraint if exists configuracion_plazas_check;
alter table public.configuracion add constraint configuracion_plazas_check check (plazas between 4 and 40);
grant update (plazas) on public.configuracion to authenticated;   -- la política ya limita los cambios al admin

-- ---------- Orden de llegada ----------
alter table public.convocatorias add column if not exists voy_desde timestamptz;
update public.convocatorias set voy_desde = updated_at where respuesta = 'voy' and voy_desde is null;

create or replace function public.convocatoria_orden()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.respuesta = 'voy' then
    if tg_op = 'UPDATE' and old.respuesta = 'voy' then
      new.voy_desde := coalesce(old.voy_desde, old.updated_at);   -- sigue en su sitio
    else
      new.voy_desde := clock_timestamp();                          -- se pone a la cola
    end if;
  else
    new.voy_desde := null;
  end if;
  return new;
end;
$$;

drop trigger if exists convocatorias_orden on public.convocatorias;
create trigger convocatorias_orden
  before insert or update on public.convocatorias
  for each row execute function public.convocatoria_orden();

-- ---------- Si se libera una plaza, entra el primer reserva ----------
create or replace function public.convocatoria_sube_reserva()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plazas int;
  v_delante int;
  v_entra uuid;
  p record;
begin
  -- Solo importa si quien se va había dicho "Voy"
  if old.respuesta <> 'voy' or (tg_op = 'UPDATE' and new.respuesta = 'voy') then
    return null;
  end if;
  select * into p from public.partidos where id = old.partido_id;
  if not found or p.estado not in ('convocatoria', 'equipos') or coalesce(p.fecha_fin, p.fecha) < now() then
    return null;
  end if;
  select plazas into v_plazas from public.configuracion where id;
  v_plazas := coalesce(v_plazas, 14);

  -- ¿Era titular? (cuántos tenía delante)
  select count(*) into v_delante
  from public.convocatorias c
  where c.partido_id = old.partido_id and c.respuesta = 'voy'
    and (coalesce(c.voy_desde, c.updated_at), c.jugador_id) < (coalesce(old.voy_desde, old.updated_at), old.jugador_id);
  if v_delante >= v_plazas then
    return null;   -- era reserva: nadie sube
  end if;

  -- El que ahora ocupa la última plaza es el que acaba de entrar
  select c.jugador_id into v_entra
  from public.convocatorias c
  where c.partido_id = old.partido_id and c.respuesta = 'voy'
  order by coalesce(c.voy_desde, c.updated_at), c.jugador_id
  offset v_plazas - 1 limit 1;

  if v_entra is not null then
    perform public.avisar(v_entra, 'reserva', '¡Entras al partido! ⚽',
      'Se ha liberado una plaza para el partido del '
        || to_char(p.fecha at time zone 'Europe/Madrid', 'DD/MM "a las" HH24:MI') || '. Ya estás dentro.',
      'partido', p.id, 'entra:' || p.id || ':' || v_entra || ':' || extract(epoch from now())::bigint);
  end if;
  return null;
end;
$$;

drop trigger if exists convocatorias_sube_reserva on public.convocatorias;
create trigger convocatorias_sube_reserva
  after update or delete on public.convocatorias
  for each row execute function public.convocatoria_sube_reserva();

-- ---------- "Equipos listos": solo a los que juegan ----------
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
