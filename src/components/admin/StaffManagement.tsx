import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Users, UserCheck, Settings, Crown, Shield, Gamepad2, Coffee, Utensils } from "lucide-react";

interface StaffMember {
  id: string;
  email: string;
  full_name: string | null;
  role: 'staff' | 'admin' | 'studio_manager';
  assigned_game_id: string | null;
  permissions?: StaffPermission[];
}

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

interface Game {
  id: string;
  name: string;
  studio: string;
}

export default function StaffManagement() {
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<StaffMember | null>(null);
  const [editingPermissions, setEditingPermissions] = useState<StaffPermission[]>([]);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const { toast } = useToast();

  const fetchStaffMembers = useCallback(async () => {
    try {
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select(`
          id,
          email,
          full_name,
          role,
          assigned_game_id
        `)
        .order('created_at', { ascending: true });

      if (profilesError) throw profilesError;

      // Fetch permissions for each staff member
      const { data: permissions, error: permissionsError } = await supabase
        .from('staff_permissions')
        .select(`
          id,
          user_id,
          permission_type,
          game_id,
          game:games(id, name, studio)
        `);

      if (permissionsError) throw permissionsError;

      // Combine profiles with their permissions
      const staffWithPermissions = (profiles || []).map(profile => ({
        ...profile,
        permissions: permissions?.filter(p => p.user_id === profile.id) || []
      }));

      setStaffMembers(staffWithPermissions as StaffMember[]);
    } catch (error) {
      console.error('Error fetching staff members:', error);
      toast({
        title: "Error",
        description: "Failed to fetch staff members",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  const fetchGames = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('games')
        .select('id, name, studio')
        .order('name');

      if (error) throw error;
      setGames(data || []);
    } catch (error) {
      console.error('Error fetching games:', error);
    }
  }, []);

  useEffect(() => {
    void fetchStaffMembers();
    void fetchGames();
  }, [fetchGames, fetchStaffMembers]);

  const handleUpdateUser = async (userId: string, updates: { role?: 'staff' | 'admin' | 'studio_manager'; assigned_game_id?: string | null }) => {
    try {
      // Update profile
      const { error: profileError } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId);

      if (profileError) throw profileError;

      // Update permissions
      await handleUpdatePermissions(userId, editingPermissions);

      // Refresh staff members list
      await fetchStaffMembers();
      
      toast({
        title: "Success",
        description: "User updated successfully",
      });
      
      setIsEditDialogOpen(false);
      setEditingUser(null);
      setEditingPermissions([]);
    } catch (error) {
      console.error('Error updating user:', error);
      toast({
        title: "Error",
        description: "Failed to update user",
        variant: "destructive",
      });
    }
  };

  const handleUpdatePermissions = async (userId: string, newPermissions: StaffPermission[]) => {
    // First, delete all existing permissions for this user
    const { error: deleteError } = await supabase
      .from('staff_permissions')
      .delete()
      .eq('user_id', userId);

    if (deleteError) throw deleteError;

    // Then, insert new permissions
    if (newPermissions.length > 0) {
      const permissionsToInsert = newPermissions.map(p => ({
        user_id: userId,
        permission_type: p.permission_type,
        game_id: p.game_id
      }));

      const { error: insertError } = await supabase
        .from('staff_permissions')
        .insert(permissionsToInsert);

      if (insertError) throw insertError;
    }
  };

  const openEditDialog = (user: StaffMember) => {
    setEditingUser(user);
    setEditingPermissions(user.permissions || []);
    setIsEditDialogOpen(true);
  };

  const togglePermission = (type: 'food' | 'drinks' | 'game', gameId?: string) => {
    setEditingPermissions(prev => {
      const existingIndex = prev.findIndex(p => 
        p.permission_type === type && 
        (type === 'food' || type === 'drinks' ? true : p.game_id === gameId)
      );

      if (existingIndex >= 0) {
        // Remove permission
        return prev.filter((_, index) => index !== existingIndex);
      } else {
        // Add permission
        return [...prev, {
          id: `temp-${Date.now()}`,
          permission_type: type,
          game_id: gameId || null,
          game: gameId ? games.find(g => g.id === gameId) : null
        }];
      }
    });
  };

  const hasPermission = (type: 'food' | 'drinks' | 'game', gameId?: string) => {
    return editingPermissions.some(p => 
      p.permission_type === type && 
      (type === 'food' || type === 'drinks' ? true : p.game_id === gameId)
    );
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Users className="w-5 h-5" />
            <span>Staff Management</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Users className="w-5 h-5" />
            <span>Staff Management</span>
          </div>
          <Badge variant="secondary">{staffMembers.length} members</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {staffMembers.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No staff members found</p>
            </div>
          ) : (
            <div className="grid gap-4">
              {staffMembers.map((member) => (
                <div key={member.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-secondary/50 transition-colors">
                  <div className="flex items-center space-x-4">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      {member.role === 'admin' ? (
                        <Crown className="w-5 h-5 text-primary" />
                      ) : (
                        <Shield className="w-5 h-5 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="font-medium">{member.full_name || member.email}</div>
                      <div className="text-sm text-muted-foreground">{member.email}</div>
                      {member.permissions && member.permissions.length > 0 ? (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {member.permissions.map((permission, index) => (
                            <Badge key={index} variant="outline" className="text-xs">
                              {permission.permission_type === 'game' && permission.game && (
                                <>
                                  <Gamepad2 className="w-3 h-3 mr-1" />
                                  {permission.game.name}
                                </>
                              )}
                              {permission.permission_type === 'food' && (
                                <>
                                  <Utensils className="w-3 h-3 mr-1" />
                                  Food Menu
                                </>
                              )}
                              {permission.permission_type === 'drinks' && (
                                <>
                                  <Coffee className="w-3 h-3 mr-1" />
                                  Drinks
                                </>
                              )}
                            </Badge>
                          ))}
                        </div>
                      ) : member.role === 'staff' ? (
                        <div className="text-xs text-muted-foreground mt-1">
                          No permissions assigned
                        </div>
                      ) : null}
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-3">
                    <Badge variant="outline" className="text-green-600 border-green-600">
                      <UserCheck className="w-3 h-3 mr-1" />
                      Signed Up
                    </Badge>
                    
                    <Badge variant={member.role === 'admin' ? 'default' : 'secondary'}>
                      {member.role}
                    </Badge>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openEditDialog(member)}
                    >
                      <Settings className="w-4 h-4 mr-1" />
                      Edit
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>

      {/* Edit User Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          {editingUser && (
            <div className="space-y-4 py-4">
              <div>
                <Label className="text-sm font-medium">User</Label>
                <div className="mt-1 text-sm text-muted-foreground">
                  {editingUser.full_name || editingUser.email}
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select
                  value={editingUser.role}
                  onValueChange={(value: 'staff' | 'admin' | 'studio_manager') => setEditingUser({ ...editingUser, role: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                     <SelectContent className="bg-background border shadow-lg z-50">
                       <SelectItem value="staff">Staff</SelectItem>
                       <SelectItem value="admin">Admin</SelectItem>
                       <SelectItem value="studio_manager">Studio Manager</SelectItem>
                     </SelectContent>
                </Select>
              </div>

              {editingUser.role === 'staff' && (
                <div className="space-y-4">
                  <Label className="text-base font-medium">Permissions</Label>
                  
                  {/* Food Permission */}
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="food-permission"
                      checked={hasPermission('food')}
                      onCheckedChange={() => togglePermission('food')}
                    />
                    <Label htmlFor="food-permission" className="flex items-center space-x-2">
                      <Utensils className="w-4 h-4" />
                      <span>Food Menu</span>
                    </Label>
                  </div>

                  {/* Drinks Permission */}
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="drinks-permission"
                      checked={hasPermission('drinks')}
                      onCheckedChange={() => togglePermission('drinks')}
                    />
                    <Label htmlFor="drinks-permission" className="flex items-center space-x-2">
                      <Coffee className="w-4 h-4" />
                      <span>Drinks</span>
                    </Label>
                  </div>

                  {/* Games Permissions */}
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Games</Label>
                    {games.map((game) => (
                      <div key={game.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`game-${game.id}`}
                          checked={hasPermission('game', game.id)}
                          onCheckedChange={() => togglePermission('game', game.id)}
                        />
                        <Label htmlFor={`game-${game.id}`} className="flex items-center space-x-2">
                          <Gamepad2 className="w-4 h-4" />
                          <span>{game.name} ({game.studio})</span>
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-4">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsEditDialogOpen(false);
                    setEditingUser(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (editingUser) {
                      handleUpdateUser(editingUser.id, {
                        role: editingUser.role,
                        assigned_game_id: editingUser.assigned_game_id
                      });
                    }
                  }}
                >
                  Save Changes
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
