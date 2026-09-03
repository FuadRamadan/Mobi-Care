import { useEffect, useState, type FormEvent } from 'react';
import { Redirect, useLocation } from 'wouter';
import { ArrowLeft, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { usePatientAuth } from '@/patient/auth';
import {
  useRequestPatientEmailPasswordReset,
  useResetPatientEmailPassword,
  useVerifyPatientEmailPasswordResetOtp,
} from '@workspace/api-client-react';

type Mode = 'login' | 'register' | 'recover';
type RecoveryStage = 'email' | 'otp' | 'password';

// The password-policy API is restricted to HQ users. These values mirror the
// server's default policy, so the recovery screen never suggests a weaker rule.
const DEFAULT_PASSWORD_POLICY = {
  minPasswordLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSymbol: true,
};

const GENERIC_RESET_NOTICE = 'If an active patient account matches this email, we sent a six-digit verification code.';

export default function PatientLogin() {
  const { user, login, register } = usePatientAuth();
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<Mode>('login');
  const [recoveryStage, setRecoveryStage] = useState<RecoveryStage>('email');
  const [name, setName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryAfter, setRetryAfter] = useState(0);
  const [passwordPolicy, setPasswordPolicy] = useState(DEFAULT_PASSWORD_POLICY);
  const requestReset = useRequestPatientEmailPasswordReset();
  const verifyOtp = useVerifyPatientEmailPasswordResetOtp();
  const resetPassword = useResetPatientEmailPassword();

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = window.setInterval(() => setRetryAfter((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [retryAfter]);

  if (user) return <Redirect to="/app/search" />;

  const passwordRequirements = [
    { label: `At least ${passwordPolicy.minPasswordLength} characters`, met: newPassword.length >= passwordPolicy.minPasswordLength },
    { label: 'An uppercase letter', met: !passwordPolicy.requireUppercase || /[A-Z]/.test(newPassword) },
    { label: 'A lowercase letter', met: !passwordPolicy.requireLowercase || /[a-z]/.test(newPassword) },
    { label: 'A number', met: !passwordPolicy.requireNumber || /\d/.test(newPassword) },
    { label: 'A symbol (such as @, #, or !)', met: !passwordPolicy.requireSymbol || /[^A-Za-z0-9]/.test(newPassword) },
  ];
  const passwordMeetsPolicy = passwordRequirements.every(({ met }) => met);

  function clearRecoveryState() {
    setEmail('');
    setOtp('');
    setResetToken(null);
    setNewPassword('');
    setConfirmPassword('');
    setRetryAfter(0);
    setRecoveryStage('email');
  }

  function leaveRecovery() {
    clearRecoveryState();
    setError(null);
    setNotice(null);
    setMode('login');
  }

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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await requestReset.mutateAsync({ data: { email: email.trim() } });
      setRetryAfter(Math.ceil(result.retryAfterSeconds));
      setPasswordPolicy(result.passwordPolicy);
    } catch (err: any) {
      // The endpoint deliberately does not disclose whether this address exists.
      setRetryAfter(Math.ceil(err?.data?.retryAfterSeconds ?? 60));
    } finally {
      setRecoveryStage('otp');
      setNotice(GENERIC_RESET_NOTICE);
      setBusy(false);
    }
  }

  async function verifyResetOtp(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp)) {
      setError('Enter the six-digit verification code.');
      return;
    }
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await verifyOtp.mutateAsync({ data: { email: email.trim(), otp } });
      setResetToken(result.resetToken);
      setOtp('');
      setRecoveryStage('password');
    } catch (err: any) {
      setOtp('');
      setResetToken(null);
      setError(err?.data?.error ?? 'This code is invalid or has expired. Request a new code and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function finishReset(e: FormEvent) {
    e.preventDefault();
    if (!resetToken) {
      setRecoveryStage('otp');
      setError('Verify a new code before choosing a password.');
      return;
    }
    if (!passwordMeetsPolicy) {
      setError('Your new password does not meet all requirements.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await resetPassword.mutateAsync({ data: { resetToken, newPassword } });
      clearRecoveryState();
      setMode('login');
      setNotice('Password reset successfully. Sign in with your new password.');
    } catch (err: any) {
      const message = err?.data?.error ?? err?.message ?? 'Could not reset your password.';
      if (/token.*(invalid|expired|used)|invalid.*token|expired.*token|already been used/i.test(message)) {
        setResetToken(null);
        setOtp('');
        setNewPassword('');
        setConfirmPassword('');
        setRecoveryStage('otp');
        setError('Your reset session has expired or was already used. Request a new code and try again.');
      } else {
        setError(message);
      }
    } finally {
      setBusy(false);
    }
  }

  const submitRecovery = recoveryStage === 'email' ? sendResetCode : recoveryStage === 'otp' ? verifyResetOtp : finishReset;

  return (
    <div className="min-h-screen bg-secondary/40 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-card border rounded-3xl shadow-xl p-8 relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-2 bg-primary" />
        <button type="button" onClick={() => navigate('/')} className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary transition-colors mb-6">
          <ArrowLeft className="w-4 h-4" /> Back to MobiCare
        </button>
        <div className="flex items-center justify-center gap-2 mb-6" aria-label="MobiCare">
          <img src="/mobicare-pin.png" alt="" className="h-14 w-auto" />
          <span className="font-display font-bold text-3xl leading-none"><span className="text-[#0B3D2E]">Mobi</span><span className="text-[#2E9E77]">Care</span></span>
        </div>
        <div className="text-center mb-6">
          <h1 className="font-display font-bold text-2xl text-dark-green mb-2">{mode === 'login' ? 'Welcome back' : mode === 'register' ? 'Create your account' : 'Reset your password'}</h1>
          <p className="text-muted-foreground text-sm">{mode === 'recover' ? (recoveryStage === 'email' ? 'Enter the email address on your patient account.' : recoveryStage === 'otp' ? 'Enter the six-digit code from your email.' : 'Choose a strong new password.') : 'Search medicines, compare prices, and order from trusted pharmacies.'}</p>
        </div>
        {mode !== 'recover' && <div className="grid grid-cols-2 gap-1 bg-secondary rounded-full p-1 mb-6 text-sm">
          <button type="button" onClick={() => { setMode('login'); setError(null); }} className={`py-2 rounded-full font-medium transition-colors ${mode === 'login' ? 'bg-card shadow text-dark-green' : 'text-muted-foreground'}`} data-testid="tab-login">Sign in</button>
          <button type="button" onClick={() => { setMode('register'); setError(null); }} className={`py-2 rounded-full font-medium transition-colors ${mode === 'register' ? 'bg-card shadow text-dark-green' : 'text-muted-foreground'}`} data-testid="tab-register">Register</button>
        </div>}
        <form onSubmit={mode === 'recover' ? submitRecovery : onSubmit} className="space-y-4" autoComplete="on" name={mode === 'recover' ? 'patient-password-reset' : 'patient-auth'}>
          {mode === 'register' && <><div className="space-y-1.5"><Label htmlFor="pt-name">Full name</Label><Input id="pt-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} data-testid="input-name" /></div><div className="space-y-1.5"><Label htmlFor="pt-date-of-birth">Date of birth</Label><Input id="pt-date-of-birth" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} max={new Date().toISOString().slice(0, 10)} required data-testid="input-date-of-birth" /><p className="text-xs text-muted-foreground">You must be at least 18 years old to register.</p></div></>}
          {mode !== 'recover' && <><div className="space-y-1.5"><Label htmlFor="pt-phone">Phone number</Label><Input id="pt-phone" name="username" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+232 76 000 000" autoComplete="username" required minLength={5} data-testid="input-phone" /></div><div className="space-y-1.5"><Label htmlFor="pt-password">Password</Label><Input id="pt-password" name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'register' ? 8 : 1} data-testid="input-password" />{mode === 'register' && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}</div></>}
          {mode === 'recover' && recoveryStage === 'email' && <div className="space-y-1.5"><Label htmlFor="pt-reset-email">Email address</Label><Input id="pt-reset-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required maxLength={320} data-testid="input-reset-email" /></div>}
          {mode === 'recover' && recoveryStage === 'otp' && <div className="space-y-1.5"><Label htmlFor="pt-reset-code">Verification code</Label><Input id="pt-reset-code" name="one-time-code" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" data-testid="input-reset-code" /></div>}
          {mode === 'recover' && recoveryStage === 'password' && <><div className="space-y-1.5"><Label htmlFor="pt-new-password">New password</Label><Input id="pt-new-password" name="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required autoComplete="new-password" /></div><ul className="space-y-1 text-xs text-muted-foreground" aria-label="Password requirements">{passwordRequirements.map(({ label, met }) => <li key={label} className={met ? 'text-primary' : undefined}><Check className="inline h-3.5 w-3.5 mr-1" aria-hidden="true" />{label}</li>)}</ul><div className="space-y-1.5"><Label htmlFor="pt-confirm-password">Confirm new password</Label><Input id="pt-confirm-password" name="new-password-confirmation" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required autoComplete="new-password" /></div></>}
          {error && <p className="text-sm text-destructive" data-testid="text-login-error">{error}</p>}
          {notice && <p className="text-sm text-primary" role="status" data-testid="text-login-notice">{notice}</p>}
          <Button type="submit" className="w-full rounded-full" disabled={busy} data-testid="button-submit">{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : recoveryStage === 'email' ? 'Send verification code' : recoveryStage === 'otp' ? 'Verify code' : 'Reset password'}</Button>
          {mode === 'login' && <button type="button" onClick={() => { clearRecoveryState(); setMode('recover'); setError(null); setNotice(null); }} className="w-full text-sm font-medium text-primary hover:underline" data-testid="button-forgot-password">Forgot password?</button>}
          {mode === 'recover' && <div className="flex justify-between gap-4 text-sm"><button type="button" onClick={leaveRecovery} className="font-medium text-primary hover:underline">Back to sign in</button>{recoveryStage === 'otp' && <button type="button" onClick={sendResetCode} disabled={busy || retryAfter > 0} className="font-medium text-primary hover:underline disabled:text-muted-foreground disabled:no-underline">{retryAfter > 0 ? `Resend in ${retryAfter}s` : 'Resend code'}</button>}</div>}
        </form>
      </div>
      <p className="text-xs text-muted-foreground mt-6">Pharmacies and HQ staff have their own portals.</p>
    </div>
  );
}