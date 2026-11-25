-- =====================================================================
-- GUMMI APP · Script 9: vincular externos con cuentas (versión segura)
-- Ejecutar DESPUÉS de los scripts 1 a 8.
-- Pegar entero en Supabase > SQL Editor > New query > Run
--
-- Qué hace:
--   Un externo (alguien sin cuenta) puede tener histórico de partidos.
--   Cuando ese amigo por fin tiene cuenta, el admin lo vincula desde la app
--   (Jugadores > Vincular) y conserva todo su histórico.
--
--   Esta versión añade una protección: si la cuenta nueva ya tiene partidos,
--   goles o votos, NO se vincula (para no borrar nada por error). Debe estar
--   "vacía", es decir, recién creada.
--
--   Además, al vincular, se mantienen el nombre y el apodo del externo.
-- Se puede ejecutar más de una vez.
-- =====================================================================

create or replace function public.vincular_externo(p_externo uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perfil uuid;
begin
  if not public.es_admin() then
    raise exception 'Solo un admin puede vincular externos';
  end if;

  if not exists (select 1 from public.perfiles where id = p_externo and es_externo) then
    raise exception 'El perfil indicado no es un externo';
  end if;

  select id into v_perfil from public.perfiles where user_id = p_user_id and not es_externo;

  if v_perfil is not null then
    if exists (select 1 from public.participaciones where jugador_id = v_perfil)
       or exists (select 1 from public.eventos where jugador_id = v_perfil)
       or exists (select 1 from public.votos where votante_id = v_perfil or votado_id = v_perfil)
       or exists (select 1 from public.votos_mvp where votante_id = v_perfil or votado_id = v_perfil)
       or exists (select 1 from public.convocatorias where jugador_id = v_perfil) then
      raise exception 'Esa cuenta ya tiene partidos o votos y no se puede vincular';
    end if;
    delete from public.perfiles where id = v_perfil;
  end if;

  update public.perfiles
  set user_id = p_user_id, es_externo = false
  where id = p_externo and es_externo;
end;
$$;

revoke execute on function public.vincular_externo(uuid, uuid) from public, anon;
grant  execute on function public.vincular_externo(uuid, uuid) to authenticated, service_role;

-- Lista de cuentas sin vincular, para elegir en la app (solo admin).
create or replace function public.cuentas_disponibles()
returns table (user_id uuid, perfil_id uuid, nombre text)
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
  select pr.user_id, pr.id, pr.nombre
  from public.perfiles pr
  where pr.user_id is not null and not pr.es_externo
    and not exists (select 1 from public.participaciones pa where pa.jugador_id = pr.id)
    and not exists (select 1 from public.eventos e where e.jugador_id = pr.id)
    and not exists (select 1 from public.votos v where v.votante_id = pr.id or v.votado_id = pr.id)
    and not exists (select 1 from public.votos_mvp m where m.votante_id = pr.id or m.votado_id = pr.id)
  order by pr.nombre;
end;
$$;

revoke execute on function public.cuentas_disponibles() from public, anon;
grant  execute on function public.cuentas_disponibles() to authenticated, service_role;
