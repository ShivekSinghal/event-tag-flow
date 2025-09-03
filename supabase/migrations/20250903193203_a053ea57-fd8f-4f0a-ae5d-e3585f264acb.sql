-- Allow admins to update all profiles (for game assignments)
CREATE POLICY "Admins can update all profiles" 
ON public.profiles 
FOR UPDATE 
USING (public.get_current_user_role() = 'admin');