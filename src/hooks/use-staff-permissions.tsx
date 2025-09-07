import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface StaffPermission {
  id: string;
  permission_type: 'game' | 'food' | 'drinks';
  game_id: string | null;
  game?: {
    id: string;
    name: string;
    studio: string;
  } | null;
}

export function useStaffPermissions() {
  const { user } = useAuth();
  const [permissions, setPermissions] = useState<StaffPermission[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (user) {
      fetchPermissions();
    } else {
      setPermissions([]);
      setIsLoading(false);
    }
  }, [user]);

  const fetchPermissions = async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from('staff_permissions')
        .select(`
          id,
          permission_type,
          game_id,
          game:games(id, name, studio)
        `)
        .eq('user_id', user.id);

      if (error) throw error;
      setPermissions((data || []) as StaffPermission[]);
    } catch (error) {
      console.error('Error fetching permissions:', error);
      setPermissions([]);
    } finally {
      setIsLoading(false);
    }
  };

  const hasPermission = (type: 'game' | 'food' | 'drinks', gameId?: string) => {
    return permissions.some(p => 
      p.permission_type === type && 
      (type === 'food' || type === 'drinks' || p.game_id === gameId)
    );
  };

  const getGamePermissions = () => {
    return permissions
      .filter(p => p.permission_type === 'game' && p.game)
      .map(p => p.game!)
      .filter(Boolean);
  };

  const hasFoodPermission = () => hasPermission('food');
  const hasDrinksPermission = () => hasPermission('drinks');

  return {
    permissions,
    isLoading,
    hasPermission,
    getGamePermissions,
    hasFoodPermission,
    hasDrinksPermission,
    refetch: fetchPermissions
  };
}