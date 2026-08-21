import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useChangePassword } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lock, ShieldAlert, Check, X } from "lucide-react";
import { calculateDaysRemaining, checkPasswordStrength } from "@/utils/password";
import { useLocation } from "wouter";

export default function ChangePassword() {
  const { completePasswordChange, logout, user, passwordPolicy } = useAuth();
  const [, setLocation] = useLocation();
  const changePassword = useChangePassword();
  
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  
  const [debouncedNewPassword, setDebouncedNewPassword] = useState("");
  const [debouncedConfirmPassword, setDebouncedConfirmPassword] = useState("");

  const [error, setError] = useState<{ message: string; policyErrors?: string[] } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedNewPassword(newPassword);
      setDebouncedConfirmPassword(confirmPassword);
    }, 250);
    return () => clearTimeout(timer);
  }, [newPassword, confirmPassword]);

  const isForced = user?.mustChangePassword;
  const daysRemaining = calculateDaysRemaining(user, passwordPolicy);

  const minLength = passwordPolicy?.minPasswordLength || 8;
  const reqUpper = passwordPolicy?.requireUppercase ?? true;
  const reqLower = passwordPolicy?.requireLowercase ?? true;
  const reqNumber = passwordPolicy?.requireNumber ?? true;
  const reqSymbol = passwordPolicy?.requireSymbol ?? true;

  const buildRules = (password: string, confirmation: string) => [
    { id: 'length', label: `At least ${minLength} characters`, passed: password.length >= minLength, enabled: true },
    { id: 'upper', label: 'One uppercase letter', passed: /[A-Z]/.test(password), enabled: reqUpper },
    { id: 'lower', label: 'One lowercase letter', passed: /[a-z]/.test(password), enabled: reqLower },
    { id: 'number', label: 'One number', passed: /[0-9]/.test(password), enabled: reqNumber },
    { id: 'symbol', label: 'One special character', passed: /[^A-Za-z0-9]/.test(password), enabled: reqSymbol },
    { id: 'match', label: 'Passwords match', passed: password.length > 0 && password === confirmation, enabled: true },
  ].filter(r => r.enabled);

  const rules = buildRules(debouncedNewPassword, debouncedConfirmPassword);
  const allCurrentRulesPassed = buildRules(newPassword, confirmPassword).every(r => r.passed);
  const canSubmit = currentPassword.length > 0 && allCurrentRulesPassed && !changePassword.isPending;

  const strength = checkPasswordStrength(debouncedNewPassword);
  
  const getStrengthStyles = () => {
    if (debouncedNewPassword.length === 0) return { width: '0%', color: 'bg-muted' };
    if (strength === 'weak') return { width: '33%', color: 'bg-destructive' };
    if (strength === 'medium') return { width: '66%', color: 'bg-yellow-500' };
    return { width: '100%', color: 'bg-green-500' };
  };

  const getStrengthLabel = () => {
    if (debouncedNewPassword.length === 0) return "";
    if (strength === 'weak') return "Weak";
    if (strength === 'medium') return "Medium";
    return "Strong";
  };
  
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    
    setError(null);
    try {
      const result = await changePassword.mutateAsync({
        data: {
          currentPassword,
          newPassword
        }
      });
      completePasswordChange(result);
    } catch (e: any) {
      const data = e.data;
      if (data?.code === 'TEMPORARY_PASSWORD_EXPIRED') {
        setError({
          message: "Your temporary password has expired. Please contact MobiCare HQ to issue a new one."
        });
      } else if (data?.messages && Array.isArray(data.messages)) {
        setError({
          message: data.error || "Password change failed.",
          policyErrors: data.messages
        });
      } else {
        setError({
          message: data?.error || e?.message || "Failed to change password. Please check your current password."
        });
      }
    }
  };

  const handleCancel = () => {
    if (isForced) {
      logout();
    } else {
      setLocation("/dashboard");
    }
  };

  const title = isForced ? "Secure Your Account" : "Update Password";
  const description = isForced 
    ? "You must set a new secure password before you can access the pharmacy portal."
    : `Your password expires in ${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'}. Please choose a new one to continue accessing the portal without interruption.`;

  return (
    <div className="min-h-[100dvh] flex bg-background">
      <div className="flex-1 flex flex-col justify-center px-4 sm:px-6 lg:px-20 xl:px-24">
        <div className="mx-auto w-full max-w-md">
          <div className="flex flex-col items-center text-center">
            <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mb-6">
              <Lock className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              {title}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-sm">
              {description}
            </p>
          </div>

          <div className="mt-8">
            <form onSubmit={onSubmit} className="space-y-6">
              {error && (
                <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md flex gap-3">
                  <ShieldAlert className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-destructive font-medium">{error.message}</p>
                    {error.policyErrors && error.policyErrors.length > 0 && (
                      <ul className="mt-2 list-disc pl-4 text-xs text-destructive/90 space-y-1">
                        {error.policyErrors.map((msg, i) => (
                          <li key={i}>{msg}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="currentPassword" className="text-sm font-medium leading-none">
                    Current or Temporary Password
                  </label>
                  <Input
                    id="currentPassword"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="h-11"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="newPassword" className="text-sm font-medium leading-none">
                    New Password
                  </label>
                  <Input
                    id="newPassword"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="h-11"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="confirmPassword" className="text-sm font-medium leading-none">
                    Confirm New Password
                  </label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="h-11"
                    required
                    aria-invalid={debouncedConfirmPassword.length > 0 && debouncedNewPassword !== debouncedConfirmPassword}
                  />
                </div>
              </div>

              <div
                className="space-y-2 mt-4 bg-muted/40 p-4 rounded-md border border-border/50"
                aria-live="polite"
              >
                <p className="text-sm font-medium mb-3 text-foreground/90">Password Requirements</p>
                <ul className="space-y-2">
                  {rules.map(rule => (
                    <li key={rule.id} className="flex items-center gap-2.5 text-sm">
                      {rule.passed ? (
                        <Check className="w-4 h-4 text-green-600 shrink-0" aria-hidden="true" />
                      ) : (
                        <X className="w-4 h-4 text-muted-foreground/60 shrink-0" aria-hidden="true" />
                      )}
                      <span className={rule.passed ? "text-foreground" : "text-muted-foreground"}>
                        {rule.label}
                      </span>
                    </li>
                  ))}
                </ul>
                {debouncedNewPassword.length > 0 && (
                  <div className="mt-5 pt-4 border-t border-border">
                    <div className="flex justify-between items-center mb-2 text-xs font-semibold uppercase tracking-wide">
                      <span className="text-muted-foreground">Strength</span>
                      <span className={
                        strength === 'weak' ? 'text-destructive' : 
                        strength === 'medium' ? 'text-yellow-600' : 'text-green-600'
                      }>{getStrengthLabel()}</span>
                    </div>
                    <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-500 ease-out ${getStrengthStyles().color}`} 
                        style={{ width: getStrengthStyles().width }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-2 flex gap-4">
                <Button 
                  type="submit" 
                  className="flex-1 h-11 text-base font-semibold shadow-md"
                  disabled={!canSubmit}
                >
                  {changePassword.isPending ? "Saving..." : "Save Password"}
                </Button>
                <Button 
                  type="button" 
                  variant="outline"
                  className="h-11"
                  onClick={handleCancel}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div className="hidden lg:block relative w-0 flex-1 bg-muted">
        <div className="absolute inset-0 h-full w-full bg-[#0B3D2E]">
          <div className="absolute inset-0 bg-gradient-to-br from-black/30 to-transparent" />
          <div className="flex items-center justify-center h-full">
            <div className="text-white/80 p-12 max-w-lg text-center">
              <ShieldAlert className="w-12 h-12 text-white/50 mx-auto mb-6" />
              <h1 className="text-4xl font-bold text-white mb-6">Security First</h1>
              <p className="text-lg leading-relaxed">
                MobiCare requires a strong, unique password to ensure patient data remains private and secure. 
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
