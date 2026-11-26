-- =====================================================================
-- GUMMI APP · Deshacer el script 16 (lista de reservas)
-- Deja la base de datos como estaba antes de ejecutar 16_reservas.sql.
-- Se pierde solo el orden de llegada y el número de plazas (lo demás queda igual).
-- =====================================================================

drop trigger if exists convocatorias_sube_reserva on public.convocatorias;
drop trigger if exists convocatorias_orden on public.convocatorias;
drop function if exists public.convocatoria_sube_reserva();
drop function if exists public.convocatoria_orden();
alter table public.convocatorias drop column if exists voy_desde;
alter table public.configuracion drop constraint if exists configuracion_plazas_check;
alter table public.configuracion drop column if exists plazas;

-- El aviso de "Equipos listos" vuelve a ser como en el script 08
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
