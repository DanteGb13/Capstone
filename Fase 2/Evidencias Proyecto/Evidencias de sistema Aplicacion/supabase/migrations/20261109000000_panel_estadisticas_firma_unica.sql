-- =====================================================
-- Dejar UNA sola firma de admin_estadisticas_panel
--
-- En la base quedaron dos: la de cuatro parámetros (la de la migración
-- 20261103000000) y una más vieja de cinco, con `p_actividad`. PostgREST
-- no sabe cuál elegir y el panel fallaba con:
--
--   Could not choose the best candidate function between:
--   public.admin_estadisticas_panel(p_dias, p_rol, p_licencia, p_vinculacion),
--   public.admin_estadisticas_panel(p_dias, p_rol, p_licencia, p_vinculacion,
--   p_actividad)
--
-- Pasó por usar `create or replace` con una firma distinta: eso CREA una
-- función nueva en lugar de reemplazar la anterior, y la vieja se queda
-- viva. Nada en la app ni en las migraciones usa la de cinco parámetros,
-- así que se elimina.
-- =====================================================
drop function if exists public.admin_estadisticas_panel(integer, text, text, text, text);

-- Por si el drop dejó los permisos colgando, se reafirman sobre la firma
-- que sí se usa.
revoke execute on function public.admin_estadisticas_panel(integer, text, text, text) from public, anon;
grant execute on function public.admin_estadisticas_panel(integer, text, text, text) to authenticated;
