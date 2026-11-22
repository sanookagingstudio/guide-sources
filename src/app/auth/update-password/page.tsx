'use client';

import { FormEvent, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function UpdatePasswordPage() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('Checking recovery session...');

  useEffect(() => {
    const run = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setReady(true);
        setMessage('Enter a new password.');
        return;
      }

      setReady(false);
      setMessage('Recovery session not found. Please open the latest reset password email link again.');
    };

    run();
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();

    if (password.length < 8) {
      setMessage('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirm) {
      setMessage('Passwords do not match.');
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage('Password updated. Redirecting to app...');
    setTimeout(() => {
      window.location.replace('/');
    }, 1200);
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <section className="max-w-xl mx-auto rounded-2xl border border-slate-700 bg-slate-900 p-6">
        <h1 className="text-xl font-bold mb-3">Set new password</h1>
        <p className="text-sm text-slate-300 mb-4">{message}</p>

        {ready && (
          <form onSubmit={submit} className="space-y-3">
            <input
              className="w-full rounded-xl border border-slate-600 bg-slate-800 p-3 text-sm"
              type="password"
              placeholder="New password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />

            <input
              className="w-full rounded-xl border border-slate-600 bg-slate-800 p-3 text-sm"
              type="password"
              placeholder="Confirm new password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required
            />

            <button className="w-full rounded-xl bg-amber-500 px-4 py-3 text-sm font-bold text-slate-950" type="submit">
              Update password
            </button>
          </form>
        )}

        <button
          className="mt-4 rounded-xl border border-slate-600 px-4 py-2 text-xs text-slate-200"
          onClick={() => window.location.replace('/')}
        >
          Back to Guide Sources
        </button>
      </section>
    </main>
  );
}
