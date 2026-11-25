-- =====================================================================
-- GUMMI APP · Script 3: el admin puede ver los votos individuales
-- Ejecutar DESPUÉS del script 2.
-- Pegar entero en Supabase > SQL Editor > New query > Run
--
-- Añade un interruptor en la configuración (admin_ve_votos):
--   true  -> el admin ve quién votó qué a quién (votos y MVP)
--   false -> los votos vuelven a ser anónimos también para el admin
-- Se puede ejecutar más de una vez.
-- =====================================================================

-- Interruptor (activado por defecto)
alter table public.configuracion
  add column if not exists admin_ve_votos boolean not null default true;

-- El admin puede cambiarlo desde la app
grant update (admin_ve_votos) on public.configuracion to authenticated;

-- ---- votos: el admin los ve solo si el interruptor está activado ----
drop policy if exists "votos: admin ve si está activado" on public.votos;

create policy "votos: admin ve si está activado"
  on public.votos for select to authenticated
  using (
    public.es_admin()
    and coalesce((select c.admin_ve_votos from public.configuracion c), false)
  );

-- ---- votos_mvp: igual ----
drop policy if exists "mvp: admin ve si está activado" on public.votos_mvp;

create policy "mvp: admin ve si está activado"
  on public.votos_mvp for select to authenticated
  using (
    public.es_admin()
    and coalesce((select c.admin_ve_votos from public.configuracion c), false)
  );

-- =====================================================================
-- Para activarlo o desactivarlo a mano (más adelante será un botón en la app):
--   update public.configuracion set admin_ve_votos = true;   -- ver votos
--   update public.configuracion set admin_ve_votos = false;  -- anónimos
-- =====================================================================
