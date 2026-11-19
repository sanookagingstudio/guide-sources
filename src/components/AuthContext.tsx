'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type AuthState = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  email: string | null;
  isSupabaseConfigured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const providerId = 'auth-provider-r5e';
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    console.log('AUTH_PROVIDER_MOUNT', JSON.stringify({ providerId, route: window.location.pathname }));
    let alive = true;

    if (!isSupabaseConfigured) {
      setSession(null);
      setLoading(false);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      console.log('AUTH_INITIAL_SESSION', JSON.stringify({ providerId, session: Boolean(data.session), user: Boolean(data.session?.user), tokenPresent: Boolean(data.session?.access_token), tokenLength: data.session?.access_token?.length ?? 0 }));
      setSession(data.session ?? null);
      setLoading(false);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      console.log('AUTH_STATE_CHANGE', JSON.stringify({ providerId, event: _event, session: Boolean(nextSession), user: Boolean(nextSession?.user), tokenPresent: Boolean(nextSession?.access_token), tokenLength: nextSession?.access_token?.length ?? 0 }));
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(() => ({
    loading,
    session,
    user: session?.user ?? null,
    email: session?.user?.email ?? null,
    isSupabaseConfigured,
    signIn: async (email: string, password: string) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    signOut: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setSession(null);
    },
  }), [loading, session]);

  console.log('AUTH_CONTEXT_VALUE', JSON.stringify({ providerId, loading, session: Boolean(session), user: Boolean(session?.user), tokenPresent: Boolean(session?.access_token), tokenLength: session?.access_token?.length ?? 0 }));

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}
