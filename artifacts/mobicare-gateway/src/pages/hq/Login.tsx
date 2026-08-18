import { useState, type FormEvent } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { Pill, LogIn } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useHqAuth } from '@/hq/auth';

export default function HqLogin() {
  const { user, login } = useHqAuth();
  const [, navigate] = useLocation();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Redirect to="/hq/dashboard" />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(identifier, password);
      navigate('/hq/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex-1 w-full min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border rounded-3xl shadow-xl p-8 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-2 bg-dark-green" />

        <div className="flex justify-center mb-6">
          <img src="/mobicare-pin.png" alt="MobiCare" className="h-14 w-auto" />
        </div>

        <div className="text-center mb-8">
          <h1 className="font-display font-bold text-2xl text-dark-green mb-2">MobiCare HQ</h1>
          <p className="text-muted-foreground text-sm">Authorized staff access only.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="hq-identifier">Username</Label>
            <Input
              id="hq-identifier"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoComplete="username"
              required
              data-testid="input-hq-username"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hq-password">Password</Label>
            <Input
              id="hq-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              data-testid="input-hq-password"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" data-testid="text-hq-login-error">{error}</p>
          )}

          <Button
            type="submit"
            disabled={busy}
            className="w-full bg-dark-green text-white hover:bg-dark-green/90 py-6 rounded-xl"
            data-testid="button-hq-login"
          >
            <LogIn className="w-5 h-5 mr-1" />
            {busy ? 'Signing in…' : 'Log in to Dashboard'}
          </Button>
        </form>

        <div className="text-center mt-8 pt-6 border-t">
          <Link
            href="/"
            className="text-sm text-muted-foreground hover:text-primary transition-colors flex items-center justify-center gap-2"
          >
            <Pill className="w-4 h-4" />
            Return to public site
          </Link>
        </div>
      </div>
    </div>
  );
}
