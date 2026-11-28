-- GUMMI APP · Deshacer el script 22: no se puede votar a externos

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
                where id = p_votado and not es_externo)
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
