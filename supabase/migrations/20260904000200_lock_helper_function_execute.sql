-- Remove inherited public execute from helper functions while keeping app access for signed-in users.

REVOKE EXECUTE ON FUNCTION public.get_current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_current_user_role() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.user_has_permission(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_has_permission(UUID, TEXT, UUID) TO authenticated;
