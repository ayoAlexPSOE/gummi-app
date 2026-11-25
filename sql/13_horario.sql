-- =====================================================================
-- GUMMI APP · Script 13: horario del partido (inicio y fin)
-- Ejecutar DESPUÉS de los scripts anteriores.
-- Pegar entero en Supabase > SQL Editor > New query > Run
--
-- Qué hace:
--   * Añade la hora de fin a cada partido (p. ej. de 14:00 a 15:00).
--     Los partidos que ya existen se quedan sin hora de fin.
--   * El aviso de "Nuevo partido" muestra el horario completo.
-- Se puede ejecutar más de una vez.
-- =====================================================================

alter table public.partidos add column if not exists fecha_fin timestamptz;

alter table public.partidos drop constraint if exists partidos_fecha_fin_check;
alter table public.partidos add  constraint partidos_fecha_fin_check
  check (fecha_fin is null or fecha_fin > fecha);

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
  v_cuerpo := to_char(new.fecha at time zone 'Europe/Madrid', 'DD/MM "de" HH24:MI')
              || coalesce(' a ' || to_char(new.fecha_fin at time zone 'Europe/Madrid', 'HH24:MI'), '')
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
