import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Users, UserCheck, Settings, Crown, Shield } from "lucide-react";

interface StaffMember {
  id: string;
  email: string;
  full_name: string | null;
  role: 'staff' | 'admin' | 'studio_manager';
  assigned_game_id: string | null;
  assigned_game?: {
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
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchStaffMembers();
    fetchGames();
  }, []);

  const fetchStaffMembers = async () => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select(`
          id,
          email,
          full_name,
          role,
          assigned_game_id,
          assigned_game:games(name, studio)
        `)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setStaffMembers((data || []) as StaffMember[]);
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
  };

  const fetchGames = async () => {
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
  };

  const handleUpdateUser = async (userId: string, updates: { role?: 'staff' | 'admin' | 'studio_manager'; assigned_game_id?: string | null }) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId);

      if (error) throw error;

      // Refresh staff members list
      await fetchStaffMembers();
      
      toast({
        title: "Success",
        description: "User updated successfully",
      });
      
      setIsEditDialogOpen(false);
      setEditingUser(null);
    } catch (error) {
      console.error('Error updating user:', error);
      toast({
        title: "Error",
        description: "Failed to update user",
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (user: StaffMember) => {
    setEditingUser(user);
    setIsEditDialogOpen(true);
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
                      {member.assigned_game ? (
                        <div className="flex items-center mt-1">
                          <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
                            🎮 {member.assigned_game.name} ({member.assigned_game.studio})
                          </Badge>
                        </div>
                      ) : member.role === 'staff' ? (
                        <div className="text-xs text-muted-foreground mt-1">
                          No game assigned
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
                <div className="space-y-2">
                  <Label htmlFor="assigned_game">Assigned Game</Label>
                  <Select
                    value={editingUser.assigned_game_id || 'none'}
                    onValueChange={(value) => 
                      setEditingUser({ 
                        ...editingUser, 
                        assigned_game_id: value === 'none' ? null : value 
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                     <SelectContent className="bg-background border shadow-lg z-50">
                       <SelectItem value="none">No game assigned</SelectItem>
                       {games.map((game) => (
                         <SelectItem key={game.id} value={game.id}>
                           {game.name} ({game.studio})
                         </SelectItem>
                       ))}
                     </SelectContent>
                  </Select>
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
                        ...(editingUser.role === 'staff' && {
                          assigned_game_id: editingUser.assigned_game_id
                        })
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