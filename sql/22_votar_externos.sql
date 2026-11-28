-- =====================================================================
-- GUMMI APP · Script 22: se puede votar a los externos
-- Ejecutar DESPUÉS de los scripts anteriores.
--   * En la votación de cada partido se puede poner nota y elegir MVP
--     también a los externos que jugaron. Sus votos se guardan y cuentan
--     para su media, el MVP, los logros, etc.
--   * Los externos siguen sin votar (no tienen cuenta).
-- Para deshacerlo: 22_votar_externos_down.sql (los votos ya hechos a
-- externos se quedan guardados).
-- Se puede ejecutar más de una vez.
-- =====================================================================

create or replace function public.voto_valido(p_votante uuid, p_votado uuid, p_partido bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    p_votante <> p_votado
    and exists (select 1 from public.perfiles
                where id = p_votante and not es_externo and user_id is not null)
    and exists (select 1 from public.perfiles
                where id = p_votado)                       -- también externos
    and public.votacion_abierta(p_partido)
    and (
      p_partido is null
      or (
        exists (select 1 from public.participaciones
                where partido_id = p_partido and jugador_id = p_votante)
        and exists (select 1 from public.participaciones
                    where partido_id = p_partido and jugador_id = p_votado)
      )
    );
$$;
