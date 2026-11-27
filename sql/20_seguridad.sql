-- =====================================================================
-- GUMMI APP · Script 20: repaso de seguridad
-- Ejecutar DESPUÉS de los scripts 1 a 6 y 8 a 19.
-- Pegar entero en Supabase > SQL Editor > New query > Run
--
-- Qué hace:
--   * Quita a los visitantes SIN sesión ("anon") el permiso de ejecutar las
--     funciones de la base de datos. Hasta ahora, con la clave pública de la
--     web, alguien sin cuenta podía llamar a algunas (por ejemplo, ver el MVP
--     de un partido). Los jugadores con sesión siguen pudiendo lo mismo de antes.
--   * No toca tablas, columnas, datos ni políticas.
-- Para deshacerlo: 20_seguridad_down.sql
-- Se puede ejecutar más de una vez.
-- =====================================================================

do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma, has_function_privilege('authenticated', p.oid, 'execute') as auth_puede
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')   -- no las de extensiones
  loop
    -- quien tenía permiso con sesión lo conserva de forma explícita
    if f.auth_puede then
      execute format('grant execute on function %s to authenticated', f.firma);
    end if;
    execute format('revoke execute on function %s from public, anon', f.firma);
  end loop;
end;
$$;

-- Para las funciones que se creen a partir de ahora
alter default privileges in schema public revoke execute on functions from public, anon;
