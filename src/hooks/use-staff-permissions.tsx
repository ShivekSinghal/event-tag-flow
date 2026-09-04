import { useCallback, useEffect, useMemo, useState } from 'react';
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
  const userId = user?.id;
  const isAdmin = profile?.role === 'admin';
  const [permissions, setPermissions] = useState<StaffPermission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [allGames, setAllGames] = useState<{ id: string; name: string; studio: string; }[]>([]);

  const fetchAllGames = useCallback(async () => {
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
  }, []);

  const fetchPermissions = useCallback(async () => {
    if (!userId) return;

    try {
      setIsLoading(true);
      
      // Admin users don't need specific permissions - they have access to everything
      if (isAdmin) {
        setPermissions([]);
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
        .eq('user_id', userId);

      if (error) throw error;
      setPermissions((data || []) as StaffPermission[]);
    } catch (error) {
      console.error('Error fetching permissions:', error);
      setPermissions([]);
    } finally {
      setIsLoading(false);
    }
  }, [isAdmin, userId]);

  useEffect(() => {
    if (userId) {
      void fetchPermissions();
      void fetchAllGames();
    } else {
      setPermissions([]);
      setAllGames([]);
      setIsLoading(false);
    }
  }, [fetchAllGames, fetchPermissions, userId]);

  const hasPermission = useCallback((type: 'game' | 'food' | 'drinks', gameId?: string) => {
    // Admin users have access to everything
    if (isAdmin) {
      return true;
    }
    
    return permissions.some(p => 
      p.permission_type === type && 
      (type === 'food' || type === 'drinks' || p.game_id === gameId)
    );
  }, [isAdmin, permissions]);

  const gamePermissions = useMemo(() => {
    // Admin users have access to all games
    if (isAdmin) {
      return allGames;
    }
    
    return permissions
      .filter(p => p.permission_type === 'game' && p.game)
      .map(p => p.game!)
      .filter(Boolean);
  }, [allGames, isAdmin, permissions]);

  const hasFoodPermission = useMemo(() => hasPermission('food'), [hasPermission]);
  const hasDrinksPermission = useMemo(() => hasPermission('drinks'), [hasPermission]);

  return {
    permissions,
    isLoading,
    hasPermission,
    gamePermissions,
    hasFoodPermission,
    hasDrinksPermission,
    refetch: fetchPermissions
  };
}
