-- Fix the profiles table to allow new user creation
-- Add INSERT policy for profiles
CREATE POLICY "Allow new user profile creation" 
ON public.profiles 
FOR INSERT 
WITH CHECK (auth.uid() = id);

-- Create the missing trigger to automatically create profiles for new users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();