-- GUMMI APP · Deshacer el script 21 (vuelven los textos anteriores)

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

