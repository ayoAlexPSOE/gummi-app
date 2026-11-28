-- =====================================================================
-- GUMMI APP · PUESTA A CERO para el lanzamiento
-- ⚠️ BORRA DE VERDAD y no se puede deshacer (salvo con una copia de seguridad).
--
-- Se QUEDAN:
--   * Las cuentas que pongas en la lista de abajo (con su foto, nombre,
--     posición, dorsal y avisos del móvil activados).
--   * Toda la configuración de la app (plazas, scripts, avisos, logros…).
-- Se BORRA todo lo demás:
--   * Resto de cuentas (también en Authentication) y todos los externos.
--   * Partidos, convocatorias, equipos, goles, asistencias y comentarios.
--   * Todas las votaciones (inicial, de partidos y MVP) y tus notas manuales.
--   * Logros conseguidos, avisos y temporadas (se crea una nueva).
--
-- Cómo usarlo:
--   1) Crea antes en Authentication > Add user la cuenta que vaya a ser admin
--      (si aún no existe).
--   2) Cambia la lista de usuarios a conservar (sin @gummi.app), quién será
--      el admin y el nombre de la temporada.
--   3) Ejecútalo entero. Si algún usuario de la lista no existe, o si no
--      incluye al admin, se para sin borrar nada.
-- =====================================================================

do $$
declare
  -- 👇 CAMBIA ESTO
  v_conservar text[] := array['alexc', 'OTRO_USUARIO'];   -- cuentas que se quedan
  v_admin     text   := 'alexc';                          -- cuál de ellas será admin
  v_temporada text   := '2026/27';
  -- 👆
  v_correos   text[];
  v_ids       uuid[];
  v_faltan    text;
begin
  v_correos := array(select lower(u) || '@gummi.app' from unnest(v_conservar) u);

  select string_agg(c, ', ') into v_faltan
  from unnest(v_correos) c
  where not exists (select 1 from auth.users au where lower(au.email) = c);
  if v_faltan is not null then
    raise exception 'No existen estas cuentas: %. No se ha borrado nada.', v_faltan;
  end if;

  select array_agg(pr.id) into v_ids
  from public.perfiles pr join auth.users au on au.id = pr.user_id
  where lower(au.email) = any (v_correos);

  if lower(v_admin) <> all (array(select lower(u) from unnest(v_conservar) u)) then
    raise exception 'El admin (%) tiene que estar también en la lista de cuentas a conservar. No se ha borrado nada.', v_admin;
  end if;
  update public.perfiles set rol = 'admin'
  where user_id = (select id from auth.users where lower(email) = lower(v_admin) || '@gummi.app');

  if not exists (select 1 from public.perfiles where id = any (v_ids) and rol = 'admin') then
    raise exception 'En la lista no hay ningún admin: te quedarías sin acceso. No se ha borrado nada.';
  end if;

  perform set_config('app.sin_avisos', '1', true);   -- que no salgan avisos de "partido cancelado"

  -- Datos de juego
  delete from public.comentarios;
  delete from public.eventos;
  delete from public.votos_mvp;
  delete from public.votos;
  delete from public.participaciones;
  delete from public.convocatorias;
  delete from public.partidos;
  delete from public.notas_manuales;
  delete from public.logros_jugador;
  delete from public.notificaciones;

  -- Temporadas: empieza una nueva
  delete from public.temporadas;
  insert into public.temporadas (nombre, fecha_inicio, activa) values (v_temporada, current_date, true);

  -- Cuentas y perfiles que no se conservan (también los externos)
  delete from auth.users where lower(email) <> all (v_correos);
  delete from public.perfiles where not (id = any (v_ids));

  -- Configuración: votación inicial cerrada, mantenimiento a cero
  update public.configuracion set votacion_inicial_abierta = false, ultimo_mantenimiento = null where id;

  raise notice 'Puesta a cero hecha. Quedan % cuentas.', array_length(v_ids, 1);
end;
$$;

-- Comprobación: debería salir solo la gente que has conservado
select pr.nombre, pr.apodo, pr.rol, au.email
from public.perfiles pr left join auth.users au on au.id = pr.user_id
order by pr.rol, pr.nombre;
