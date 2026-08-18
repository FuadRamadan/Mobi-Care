import { useState, type FormEvent } from 'react';
import { Redirect, useLocation } from 'wouter';
import { Pill } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { usePatientAuth } from '@/patient/auth';

export default function PatientLogin() {
  const { user, login, register } = usePatientAuth();
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Redirect to="/app/search" />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(phone, password);
      else await register(name, phone, password);
      navigate('/app/search');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-secondary/40 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border rounded-3xl shadow-xl p-8 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-2 bg-primary" />

        <div className="flex justify-center mb-6">
          <div className="bg-primary/10 p-3 rounded-2xl">
            <Pill className="w-10 h-10 text-primary" strokeWidth={2} />
          </div>
        </div>

        <div className="text-center mb-6">
          <h1 className="font-display font-bold text-2xl text-dark-green mb-2">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="text-muted-foreground text-sm">
            Search medicines, compare prices, and order from trusted pharmacies.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1 bg-secondary rounded-full p-1 mb-6 text-sm">
          <button
            type="button"
            onClick={() => { setMode('login'); setError(null); }}
            className={`py-2 rounded-full font-medium transition-colors ${mode === 'login' ? 'bg-card shadow text-dark-green' : 'text-muted-foreground'}`}
            data-testid="tab-login"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => { setMode('register'); setError(null); }}
            className={`py-2 rounded-full font-medium transition-colors ${mode === 'register' ? 'bg-card shadow text-dark-green' : 'text-muted-foreground'}`}
            data-testid="tab-register"
          >
            Register
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {mode === 'register' && (
            <div className="space-y-1.5">
              <Label htmlFor="pt-name">Full name</Label>
              <Input
                id="pt-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
                minLength={2}
                data-testid="input-name"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="pt-phone">Phone number</Label>
            <Input
              id="pt-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+232 76 000 000"
              autoComplete="tel"
              required
              minLength={5}
              data-testid="input-phone"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pt-password">Password</Label>
            <Input
              id="pt-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'register' ? 8 : 1}
              data-testid="input-password"
            />
            {mode === 'register' && (
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            )}
          </div>

          {error && (
            <p className="text-sm text-destructive" data-testid="text-login-error">{error}</p>
          )}

          <Button type="submit" className="w-full rounded-full" disabled={busy} data-testid="button-submit">
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </Button>
        </form>
      </div>
      <p className="text-xs text-muted-foreground mt-6">
        Pharmacies and HQ staff have their own portals.
      </p>
    </div>
  );
}
