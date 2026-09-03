import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { AuthError, User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: 'admin' | 'staff' | 'studio_manager';
  assigned_game_id: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  profileLoading: boolean;
  profileError: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | Error | null }>;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: AuthError | Error | null }>;
  signOut: () => Promise<void>;
  isAdmin: boolean;
  isStaff: boolean;
  isStudioManager: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const profileRequestIdRef = useRef(0);
  const mountedRef = useRef(true);

  const resetProfileState = useCallback(() => {
    profileRequestIdRef.current += 1;
    setProfile(null);
    setProfileLoading(false);
    setProfileError(null);
  }, []);

  const fetchProfile = useCallback(async (userId: string) => {
    const requestId = profileRequestIdRef.current + 1;
    profileRequestIdRef.current = requestId;
    setProfileLoading(true);
    setProfileError(null);

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        if (!mountedRef.current || profileRequestIdRef.current !== requestId) return;
        console.error('Error fetching profile:', error);
        setProfile(null);
        setProfileError(error.message || 'Could not load your access profile');
        return;
      }

      if (!mountedRef.current || profileRequestIdRef.current !== requestId) return;
      setProfile(data as Profile);
    } catch (error) {
      if (!mountedRef.current || profileRequestIdRef.current !== requestId) return;
      console.error('Error fetching profile:', error);
      setProfile(null);
      setProfileError('Could not load your access profile');
    } finally {
      if (mountedRef.current && profileRequestIdRef.current === requestId) {
        setProfileLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        
        if (session?.user) {
          setProfile(null);
          // Defer profile fetching to avoid blocking auth state changes
          setTimeout(() => {
            if (mountedRef.current) {
              fetchProfile(session.user.id);
            }
          }, 0);
        } else {
          resetProfileState();
        }
        
        setLoading(false);
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        setProfile(null);
        setTimeout(() => {
          if (mountedRef.current) {
            fetchProfile(session.user.id);
          }
        }, 0);
      } else {
        resetProfileState();
      }
      
      setLoading(false);
    }).catch((error: unknown) => {
      console.error('Error getting auth session:', error);
      resetProfileState();
      setSession(null);
      setUser(null);
      setLoading(false);
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile, resetProfileState]);

  const signIn = async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        toast({
          title: "Sign In Failed",
          description: error.message,
          variant: "destructive",
        });
      }

      return { error };
    } catch (error: unknown) {
      const authError = error instanceof Error ? error : new Error('An unexpected error occurred');
      toast({
        title: "Sign In Failed",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
      return { error: authError };
    }
  };

  const signUp = async (email: string, password: string, fullName?: string) => {
    try {
      const redirectUrl = `${window.location.origin}/`;
      
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: fullName ? { full_name: fullName } : undefined,
        }
      });

      if (error) {
        toast({
          title: "Sign Up Failed",
          description: error.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Account Created",
          description: "Please check your email to verify your account.",
        });
      }

      return { error };
    } catch (error: unknown) {
      const authError = error instanceof Error ? error : new Error('An unexpected error occurred');
      toast({
        title: "Sign Up Failed",
        description: "An unexpected error occurred",
        variant: "destructive",
      });
      return { error: authError };
    }
  };

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      setSession(null);
      resetProfileState();
      toast({
        title: "Signed Out",
        description: "You have been signed out successfully.",
      });
    } catch (error: unknown) {
      console.error('Sign out failed:', error);
      toast({
        title: "Sign Out Failed",
        description: "An error occurred while signing out",
        variant: "destructive",
      });
    }
  };

  const isAdmin = profile?.role === 'admin';
  const isStaff = profile?.role === 'staff';
  const isStudioManager = profile?.role === 'studio_manager';

  const value = {
    user,
    session,
    profile,
    profileLoading,
    profileError,
    loading,
    signIn,
    signUp,
    signOut,
    isAdmin,
    isStaff,
    isStudioManager,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
