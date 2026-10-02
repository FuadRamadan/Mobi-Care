import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetPatientProfileQueryKey,
  useChangePassword,
  useConnectGoogleAccount,
  useDisconnectGoogleAccount,
  useGetGoogleSignInConfig,
  type PatientProfile,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { usePatientAuth } from '@/patient/auth';
import { GoogleButton } from '@/patient/GoogleButton';

/**
 * How the patient signs in: Google, a password, or both.
 *
 * Google is connected only from here, while signed in, never by matching an
 * email address, so nobody can take over an account with a look-alike Google
 * account.
 */
export function SignInMethods({ profile }: { profile: PatientProfile }) {
  const { toast } = useToast();
  const { logout } = usePatientAuth();
  const queryClient = useQueryClient();
  const { data: config } = useGetGoogleSignInConfig();
  const connect = useConnectGoogleAccount();
  const disconnect = useDisconnectGoogleAccount();
  const changePassword = useChangePassword();
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const googleConnected = Boolean(profile.googleConnected);
  const hasPassword = profile.hasPassword !== false;
  const refresh = () => queryClient.invalidateQueries({ queryKey: getGetPatientProfileQueryKey() });
  const problem = (err: unknown, fallback: string) =>
    toast({
      title: (err as { data?: { error?: string } } | null)?.data?.error ?? fallback,
      variant: 'destructive',
    });

  async function onConnect(credential: string) {
    try {
      await connect.mutateAsync({ data: { credential } });
      await refresh();
      toast({ title: 'Google connected. You can now sign in with Google.' });
    } catch (err) {
      problem(err, 'Could not connect Google. Try again.');
    }
  }

  async function onDisconnect() {
    if (!window.confirm('Disconnect Google? You will sign in with your phone number and password.')) return;
    try {
      await disconnect.mutateAsync();
      await refresh();
      toast({ title: 'Google disconnected' });
    } catch (err) {
      problem(err, 'Could not disconnect Google. Try again.');
    }
  }

  async function onSetPassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8 || newPassword !== confirm) return;
    try {
      await changePassword.mutateAsync({ data: { newPassword } });
      // Setting a password signs out every device, this one included.
      toast({ title: 'Password set. Sign in again with your phone number and password, or with Google.' });
      logout();
    } catch (err) {
      problem(err, 'Could not set your password. Try again.');
    }
  }

  // Nothing to show until Google sign-in is set up, unless already connected.
  if (!config?.clientId && !googleConnected) return null;

  return (
    <section className="rounded-2xl border bg-card p-4 space-y-4" data-testid="section-sign-in-methods">
      <div className="flex items-center gap-2">
        <KeyRound className="w-4 h-4 text-primary" />
        <h2 className="font-semibold">Sign-in methods</h2>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Google</p>
            <p className="text-xs text-muted-foreground">
              {googleConnected ? 'Connected. You can sign in with Google.' : 'Sign in with one tap, without a password.'}
            </p>
          </div>
          {googleConnected && hasPassword && (
            <Button variant="outline" size="sm" onClick={() => void onDisconnect()} disabled={disconnect.isPending} data-testid="button-disconnect-google">
              Disconnect
            </Button>
          )}
        </div>
        {!googleConnected && <GoogleButton onCredential={(credential) => void onConnect(credential)} text="continue_with" />}
      </div>

      <div className="border-t pt-4 space-y-2">
        <p className="text-sm font-medium">Password</p>
        {hasPassword ? (
          <p className="text-xs text-muted-foreground">Set. You can also sign in with your phone number and password.</p>
        ) : (
          <form onSubmit={(e) => void onSetPassword(e)} className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Your account uses Google only. Set a password to also sign in with your phone number.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="set-password">New password</Label>
              <Input id="set-password" type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} data-testid="input-set-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-password-confirm">Confirm password</Label>
              <Input id="set-password-confirm" type="password" autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {confirm && newPassword !== confirm && <p className="text-xs text-destructive">The passwords do not match.</p>}
            <Button type="submit" size="sm" className="rounded-full" disabled={changePassword.isPending || newPassword.length < 8 || newPassword !== confirm} data-testid="button-set-password">
              Set password
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}
