'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function AuthCallbackPage() {
  const [message, setMessage] = useState('Processing auth link...');

  useEffect(() => {
    const run = async () => {
      try {
        const hash = window.location.hash || '';
        const params = new URLSearchParams(hash.replace(/^#/, ''));
        const type = params.get('type');

        if (type === 'recovery') {
          setMessage('Recovery session ready. Redirecting to set new password...');
          window.location.replace('/auth/update-password');
          return;
        }

        const { data } = await supabase.auth.getSession();
        if (data.session) {
          setMessage('Signed in. Redirecting...');
          window.location.replace('/');
          return;
        }

        setMessage('Auth link processed. Return to app.');
      } catch (error) {
        setMessage(error instanceof Error ? error.message : 'Auth callback failed');
      }
    };

    run();
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <section className="max-w-xl mx-auto rounded-2xl border border-slate-700 bg-slate-900 p-6">
        <h1 className="text-xl font-bold mb-3">Authentication</h1>
        <p className="text-sm text-slate-300">{message}</p>
      </section>
    </main>
  );
}
