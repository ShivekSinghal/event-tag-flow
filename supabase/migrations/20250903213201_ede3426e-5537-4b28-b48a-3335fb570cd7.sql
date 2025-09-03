-- Add INSERT policy for profiles so new users can create their profiles
CREATE POLICY "Allow new user profile creation" 
ON public.profiles 
FOR INSERT 
WITH CHECK (auth.uid() = id);