-- =====================================================================
-- GUMMI APP · Script 11: perfil (foto, posiciones, dorsal, pierna)
-- Ejecutar DESPUÉS de los scripts anteriores.
-- Pegar entero en Supabase > SQL Editor > New query > Run
--
-- Qué hace:
--   * Añade a cada jugador: foto, posiciones secundarias, dorsal y pierna
--     buena. Cada uno edita lo suyo; el admin puede editar a cualquiera.
--   * Crea el almacén público "avatares" para las fotos (máx. 2 MB,
--     jpg/png/webp). Cada jugador solo puede subir/cambiar/borrar la suya
--     (el admin, la de cualquiera). Verlas puede verlas cualquiera que
--     tenga el enlace.
-- Se puede ejecutar más de una vez.
-- =====================================================================

alter table public.perfiles
  add column if not exists foto_url text,
  add column if not exists posiciones_secundarias public.posicion[] not null default '{}',
  add column if not exists dorsal smallint,
  add column if not exists pierna text;

alter table public.perfiles drop constraint if exists perfiles_dorsal_check;
alter table public.perfiles add  constraint perfiles_dorsal_check check (dorsal is null or dorsal between 0 and 99);
alter table public.perfiles drop constraint if exists perfiles_pierna_check;
alter table public.perfiles add  constraint perfiles_pierna_check check (pierna is null or pierna in ('derecha', 'izquierda', 'ambas'));

grant update (foto_url, posiciones_secundarias, dorsal, pierna) on public.perfiles to authenticated;

-- ---------- Almacén de fotos ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatares', 'avatares', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- La carpeta de cada foto es el id del perfil: avatares/<id del perfil>/avatar.jpg
drop policy if exists "avatares: ver" on storage.objects;
create policy "avatares: ver" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'avatares');

drop policy if exists "avatares: subir la propia" on storage.objects;
create policy "avatares: subir la propia" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatares'
    and ((storage.foldername(name))[1] = public.mi_perfil_id()::text or public.es_admin())
  );

drop policy if exists "avatares: cambiar la propia" on storage.objects;
create policy "avatares: cambiar la propia" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatares'
    and ((storage.foldername(name))[1] = public.mi_perfil_id()::text or public.es_admin())
  )
  with check (
    bucket_id = 'avatares'
    and ((storage.foldername(name))[1] = public.mi_perfil_id()::text or public.es_admin())
  );

drop policy if exists "avatares: borrar la propia" on storage.objects;
create policy "avatares: borrar la propia" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatares'
    and ((storage.foldername(name))[1] = public.mi_perfil_id()::text or public.es_admin())
  );
