import { useState, useEffect } from 'react';
import {
  useGetPasswordPolicy,
  useUpdatePasswordPolicy,
  getGetPasswordPolicyQueryKey,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import HqLayout from './HqLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { ShieldAlert, ShieldCheck, Check } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function HqSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: policy, isLoading } = useGetPasswordPolicy({
    query: { queryKey: getGetPasswordPolicyQueryKey() }
  });

  const update = useUpdatePasswordPolicy({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Password policy updated successfully' });
        queryClient.invalidateQueries({ queryKey: getGetPasswordPolicyQueryKey() });
      },
      onError: (err) => {
        toast({ 
          title: 'Update failed', 
          description: err instanceof Error ? err.message : 'Please try again', 
          variant: 'destructive' 
        });
      }
    }
  });

  const [form, setForm] = useState({
    maxPasswordAgeDays: 90,
    minPasswordLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumber: true,
    requireSymbol: true,
    passwordHistoryCount: 5,
    temporaryPasswordExpiryHours: 24,
  });

  useEffect(() => {
    if (policy) {
      setForm({
        maxPasswordAgeDays: policy.maxPasswordAgeDays,
        minPasswordLength: policy.minPasswordLength,
        requireUppercase: policy.requireUppercase,
        requireLowercase: policy.requireLowercase,
        requireNumber: policy.requireNumber,
        requireSymbol: policy.requireSymbol,
        passwordHistoryCount: policy.passwordHistoryCount,
        temporaryPasswordExpiryHours: policy.temporaryPasswordExpiryHours,
      });
    }
  }, [policy]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    update.mutate({ data: form });
  };

  const isDirty = policy && (
    form.maxPasswordAgeDays !== policy.maxPasswordAgeDays ||
    form.minPasswordLength !== policy.minPasswordLength ||
    form.requireUppercase !== policy.requireUppercase ||
    form.requireLowercase !== policy.requireLowercase ||
    form.requireNumber !== policy.requireNumber ||
    form.requireSymbol !== policy.requireSymbol ||
    form.passwordHistoryCount !== policy.passwordHistoryCount ||
    form.temporaryPasswordExpiryHours !== policy.temporaryPasswordExpiryHours
  );

  return (
    <HqLayout title="Security & Settings">
      <div className="max-w-3xl space-y-6">
        <div className="mb-8">
          <p className="text-muted-foreground text-sm">
            Manage global security policies for all pharmacy accounts across the network. Changes take effect immediately.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-6">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-60 w-full" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
              <div className="px-6 py-4 border-b border-border bg-muted/20 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-primary" />
                <h2 className="font-semibold text-foreground">Password Policy Configuration</h2>
              </div>
              
              <div className="p-6 space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Lifespan & Expiry */}
                  <div className="space-y-5">
                    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">Lifespan & Expiry</h3>
                    
                    <div className="space-y-2">
                      <Label htmlFor="maxPasswordAgeDays" className="flex items-center justify-between">
                        <span>Maximum Password Age (Days)</span>
                      </Label>
                      <Input 
                        id="maxPasswordAgeDays" 
                        type="number" 
                        min={1} 
                        max={365} 
                        value={form.maxPasswordAgeDays}
                        onChange={e => setForm({...form, maxPasswordAgeDays: parseInt(e.target.value) || 1})}
                      />
                      <p className="text-[11px] text-muted-foreground">Force reset after this many days.</p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="temporaryPasswordExpiryHours" className="flex items-center justify-between">
                        <span>Temp Password Expiry (Hours)</span>
                      </Label>
                      <Input 
                        id="temporaryPasswordExpiryHours" 
                        type="number" 
                        min={1} 
                        max={168} 
                        value={form.temporaryPasswordExpiryHours}
                        onChange={e => setForm({...form, temporaryPasswordExpiryHours: parseInt(e.target.value) || 1})}
                      />
                      <p className="text-[11px] text-muted-foreground">Validity window for newly generated temp passwords.</p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="passwordHistoryCount" className="flex items-center justify-between">
                        <span>Password History Count</span>
                      </Label>
                      <Input 
                        id="passwordHistoryCount" 
                        type="number" 
                        min={0} 
                        max={24} 
                        value={form.passwordHistoryCount}
                        onChange={e => setForm({...form, passwordHistoryCount: parseInt(e.target.value) || 0})}
                      />
                      <p className="text-[11px] text-muted-foreground">Number of previous passwords that cannot be reused.</p>
                    </div>
                  </div>

                  {/* Complexity */}
                  <div className="space-y-5">
                    <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-2">Complexity Rules</h3>
                    
                    <div className="space-y-2">
                      <Label htmlFor="minPasswordLength" className="flex items-center justify-between">
                        <span>Minimum Length</span>
                      </Label>
                      <Input 
                        id="minPasswordLength" 
                        type="number" 
                        min={8} 
                        max={128} 
                        value={form.minPasswordLength}
                        onChange={e => setForm({...form, minPasswordLength: parseInt(e.target.value) || 8})}
                      />
                    </div>

                    <div className="space-y-4 pt-3 border-t border-border/50">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="requireUppercase" className="cursor-pointer">Require Uppercase Letter</Label>
                        <Switch 
                          id="requireUppercase"
                          checked={form.requireUppercase}
                          onCheckedChange={v => setForm({...form, requireUppercase: v})}
                        />
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <Label htmlFor="requireLowercase" className="cursor-pointer">Require Lowercase Letter</Label>
                        <Switch 
                          id="requireLowercase"
                          checked={form.requireLowercase}
                          onCheckedChange={v => setForm({...form, requireLowercase: v})}
                        />
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <Label htmlFor="requireNumber" className="cursor-pointer">Require Number</Label>
                        <Switch 
                          id="requireNumber"
                          checked={form.requireNumber}
                          onCheckedChange={v => setForm({...form, requireNumber: v})}
                        />
                      </div>
                      
                      <div className="flex items-center justify-between">
                        <Label htmlFor="requireSymbol" className="cursor-pointer">Require Symbol</Label>
                        <Switch 
                          id="requireSymbol"
                          checked={form.requireSymbol}
                          onCheckedChange={v => setForm({...form, requireSymbol: v})}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="px-6 py-4 bg-muted/10 border-t border-border flex items-center justify-end gap-3">
                {isDirty && (
                  <span className="text-sm text-amber-600 flex items-center gap-1.5 mr-auto">
                    <ShieldAlert className="w-4 h-4" />
                    Unsaved changes
                  </span>
                )}
                <Button 
                  type="button" 
                  variant="outline" 
                  disabled={!isDirty || update.isPending}
                  onClick={() => {
                    if (policy) {
                      setForm({
                        maxPasswordAgeDays: policy.maxPasswordAgeDays,
                        minPasswordLength: policy.minPasswordLength,
                        requireUppercase: policy.requireUppercase,
                        requireLowercase: policy.requireLowercase,
                        requireNumber: policy.requireNumber,
                        requireSymbol: policy.requireSymbol,
                        passwordHistoryCount: policy.passwordHistoryCount,
                        temporaryPasswordExpiryHours: policy.temporaryPasswordExpiryHours,
                      });
                    }
                  }}
                >
                  Discard
                </Button>
                <Button type="submit" disabled={!isDirty || update.isPending}>
                  {update.isPending ? 'Saving...' : 'Save Policy'}
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </HqLayout>
  );
}
