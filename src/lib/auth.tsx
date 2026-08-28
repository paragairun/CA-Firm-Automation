import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';
import type { Database } from './database.types';

type StaffRow = Database['public']['Tables']['staff']['Row'];

interface AuthContextValue {
  session: Session | null;
  staff: StaffRow | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<StaffRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadStaffFor(currentSession: Session | null) {
      if (!currentSession) {
        if (!cancelled) setStaff(null);
        return;
      }
      const { data } = await supabase
        .from('staff')
        .select('*')
        .eq('auth_user_id', currentSession.user.id)
        .maybeSingle();
      if (!cancelled) setStaff(data ?? null);
    }

    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      if (cancelled) return;
      setSession(initialSession);
      loadStaffFor(initialSession).finally(() => {
        if (!cancelled) setLoading(false);
      });
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      loadStaffFor(newSession);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
  }

  return <AuthContext.Provider value={{ session, staff, loading, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
