-- Create staff permissions table to allow multiple assignments
CREATE TABLE public.staff_permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission_type TEXT NOT NULL CHECK (permission_type IN ('game', 'food', 'drinks')),
  game_id UUID REFERENCES public.games(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Ensure unique combinations
  UNIQUE(user_id, permission_type, game_id)
);

-- Enable RLS
ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;

-- Create policies for staff permissions
CREATE POLICY "Admins can manage all permissions" 
ON public.staff_permissions 
FOR ALL 
USING (get_current_user_role() = 'admin');

CREATE POLICY "Users can view their own permissions" 
ON public.staff_permissions 
FOR SELECT 
USING (auth.uid() = user_id);

-- Create function to check if user has permission
CREATE OR REPLACE FUNCTION public.user_has_permission(
  _user_id UUID, 
  _permission_type TEXT, 
  _game_id UUID DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.staff_permissions 
    WHERE user_id = _user_id 
      AND permission_type = _permission_type
      AND (
        _game_id IS NULL OR 
        game_id = _game_id OR 
        _permission_type IN ('food', 'drinks')
      )
  );
$$;

-- Create trigger for updated_at
CREATE TRIGGER update_staff_permissions_updated_at
BEFORE UPDATE ON public.staff_permissions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();