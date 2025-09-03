-- Add studio manager role support
-- Update role column to include studio_manager as a valid option
-- Note: In PostgreSQL, text columns don't have enum constraints by default,
-- so we'll add a check constraint to validate the role values

ALTER TABLE public.profiles 
DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles 
ADD CONSTRAINT profiles_role_check 
CHECK (role IN ('staff', 'admin', 'studio_manager'));