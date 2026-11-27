-- GUMMI APP · Deshacer el script 20: los visitantes sin sesión vuelven a poder
-- ejecutar las funciones que puede ejecutar un jugador con sesión.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as firma
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and has_function_privilege('authenticated', p.oid, 'execute')
  loop
    execute format('grant execute on function %s to anon', f.firma);
  end loop;
end;
$$;
alter default privileges in schema public grant execute on functions to anon;
