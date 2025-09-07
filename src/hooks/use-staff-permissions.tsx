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
  const { user, profile } = useAuth();
  const [permissions, setPermissions] = useState<StaffPermission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [allGames, setAllGames] = useState<{ id: string; name: string; studio: string; }[]>([]);

  useEffect(() => {
    if (user) {
      fetchPermissions();
      fetchAllGames();
    } else {
      setPermissions([]);
      setAllGames([]);
      setIsLoading(false);
    }
  }, [user]);

  const fetchAllGames = async () => {
    try {
      const { data, error } = await supabase
        .from('games')
        .select('id, name, studio')
        .order('name');

      if (error) throw error;
      setAllGames(data || []);
    } catch (error) {
      console.error('Error fetching all games:', error);
      setAllGames([]);
    }
  };

  const fetchPermissions = async () => {
    if (!user) return;

    try {
      setIsLoading(true);
      
      // Admin users don't need specific permissions - they have access to everything
      if (profile?.role === 'admin') {
        setPermissions([]);
        setIsLoading(false);
        return;
      }

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
    // Admin users have access to everything
    if (profile?.role === 'admin') {
      return true;
    }
    
    return permissions.some(p => 
      p.permission_type === type && 
      (type === 'food' || type === 'drinks' || p.game_id === gameId)
    );
  };

  const getGamePermissions = () => {
    // Admin users have access to all games
    if (profile?.role === 'admin') {
      return allGames;
    }
    
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