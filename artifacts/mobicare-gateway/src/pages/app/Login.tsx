import { useEffect, useState, type FormEvent } from 'react';
import { Redirect, useLocation } from 'wouter';
import { ArrowLeft } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { usePatientAuth } from '@/patient/auth';
import {
  useConfirmPatientPasswordReset,
  useRequestPatientPasswordReset,
} from '@workspace/api-client-react';

type Mode = 'login' | 'register' | 'recover';

export default function PatientLogin() {
  const { user, login, register } = usePatientAuth();
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [retryAfter, setRetryAfter] = useState(0);
  const requestReset = useRequestPatientPasswordReset();
  const confirmReset = useConfirmPatientPasswordReset();

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = window.setInterval(
      () => setRetryAfter((current) => Math.max(0, current - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [retryAfter]);

  if (user) return <Redirect to="/app/search" />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(phone, password);
      else await register(name, phone, password, dateOfBirth);
      navigate('/app/search');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function sendResetCode() {
    if (phone.trim().length < 5) {
      setError('Enter your registered phone number.');
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await requestReset.mutateAsync({ data: { phone: phone.trim() } });
      setRequestId(result.requestId);
      setRetryAfter(Math.ceil(result.retryAfterSeconds));
    } catch (err: any) {
      setError(err?.data?.error ?? err?.message ?? 'Could not request a code. Try again.');
      if (typeof err?.data?.retryAfterSeconds === 'number') {
        setRetryAfter(Math.ceil(err.data.retryAfterSeconds));
      }
    } finally {
      setBusy(false);
    }
  }

  async function finishReset(e: FormEvent) {
    e.preventDefault();
    if (!requestId) return sendResetCode();
    if (newPassword.length < 8) {
      setError('Your new password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const resetPassword = newPassword;
      await confirmReset.mutateAsync({
        data: { requestId, code, newPassword: resetPassword },
      });
      setMode('login');
      // Keep the successful credential only in this live form so the browser can
      // associate the async reset with the phone-number username and offer its
      // own save/update UI. Nothing is written to MobiCare-managed storage.
      setPassword(resetPassword);
      setCode('');
      setNewPassword('');
      setConfirmPassword('');
      setRequestId(null);
      setNotice('Password reset successfully. Sign in with your new password.');
    } catch (err: any) {
      setError(err?.data?.error ?? err?.message ?? 'Could not reset your password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-secondary/40 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border rounded-3xl shadow-xl p-8 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-2 bg-primary" />

        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to MobiCare
        </button>

        <div className="flex items-center justify-center gap-2 mb-6" aria-label="MobiCare">
          <img src="/mobicare-pin.png" alt="" className="h-14 w-auto" />
          <span className="font-display font-bold text-3xl leading-none">
            <span className="text-[#0B3D2E]">Mobi</span>
            <span className="text-[#2E9E77]">Care</span>
          </span>
        </div>

        <div className="text-center mb-6">
          <h1 className="font-display font-bold text-2xl text-dark-green mb-2">
            {mode === 'login' ? 'Welcome back' : mode === 'register' ? 'Create your account' : 'Reset your password'}
          </h1>
          <p className="text-muted-foreground text-sm">
            Search medicines, compare prices, and order from trusted pharmacies.
          </p>
        </div>

        {mode !== 'recover' && <div className="grid grid-cols-2 gap-1 bg-secondary rounded-full p-1 mb-6 text-sm">
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
        </div>}

        <form
          onSubmit={mode === 'recover' ? finishReset : onSubmit}
          className="space-y-4"
          autoComplete="on"
          name={mode === 'recover' ? 'patient-password-reset' : 'patient-auth'}
        >
          {mode === 'register' && (
            <>
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
              <div className="space-y-1.5">
                <Label htmlFor="pt-date-of-birth">Date of birth</Label>
                <Input
                  id="pt-date-of-birth"
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                  required
                  data-testid="input-date-of-birth"
                />
                <p className="text-xs text-muted-foreground">
                  You must be at least 18 years old to register.
                </p>
              </div>
            </>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="pt-phone">Phone number</Label>
            <Input
              id="pt-phone"
              name="username"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+232 76 000 000"
              autoComplete="username"
              required
              minLength={5}
              data-testid="input-phone"
            />
          </div>
          {mode !== 'recover' && <div className="space-y-1.5">
            <Label htmlFor="pt-password">Password</Label>
            <Input
              id="pt-password"
              name="password"
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
          </div>}

          {mode === 'recover' && requestId && (
            <>
              <p className="text-sm text-muted-foreground">
                If this number belongs to an active patient account, we sent a six-digit SMS code.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="pt-reset-code">Verification code</Label>
                <Input
                  id="pt-reset-code"
                  name="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  pattern="[0-9]{6}"
                  data-testid="input-reset-code"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pt-new-password">New password</Label>
                <Input id="pt-new-password" name="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pt-confirm-password">Confirm new password</Label>
                <Input id="pt-confirm-password" name="new-password-confirmation" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
              </div>
            </>
          )}

          {error && (
            <p className="text-sm text-destructive" data-testid="text-login-error">{error}</p>
          )}
          {notice && (
            <p className="text-sm text-primary" role="status" data-testid="text-login-notice">{notice}</p>
          )}

          <Button
            type="submit"
            className="w-full rounded-full"
            disabled={busy}
            data-testid="button-submit"
          >
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : requestId ? 'Reset password' : 'Send verification code'}
          </Button>
          {mode === 'login' && (
            <button type="button" onClick={() => { setMode('recover'); setError(null); setNotice(null); }} className="w-full text-sm font-medium text-primary hover:underline" data-testid="button-forgot-password">
              Forgot password?
            </button>
          )}
          {mode === 'recover' && (
            <div className="flex justify-between gap-4 text-sm">
              <button type="button" onClick={() => { setMode('login'); setError(null); setRequestId(null); }} className="font-medium text-primary hover:underline">
                Back to sign in
              </button>
              {requestId && (
                <button type="button" onClick={sendResetCode} disabled={busy || retryAfter > 0} className="font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline">
                  {retryAfter > 0 ? `Resend in ${retryAfter}s` : 'Resend code'}
                </button>
              )}
            </div>
          )}
        </form>
      </div>
      <p className="text-xs text-muted-foreground mt-6">
        Pharmacies and HQ staff have their own portals.
      </p>
    </div>
  );
}
