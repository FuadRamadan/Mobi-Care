import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetOrangeSmsConnection,
  getGetOrangeSmsConnectionQueryKey,
  useUpdateOrangeSmsConnection,
  useTestOrangeSmsConnection,
} from '@workspace/api-client-react';
import HqLayout from './HqLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Cable, Save, Signal, ShieldCheck, ShieldAlert, AlertCircle, Info, Activity, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function HqApiConnections() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: connection, isLoading } = useGetOrangeSmsConnection({
    query: { queryKey: getGetOrangeSmsConnectionQueryKey() }
  });

  const update = useUpdateOrangeSmsConnection({
    mutation: {
      onSuccess: () => {
        toast({ title: 'Connection settings saved' });
        queryClient.invalidateQueries({ queryKey: getGetOrangeSmsConnectionQueryKey() });
        setForm(prev => ({ ...prev, clientId: '', clientSecret: '' }));
      },
      onError: (err: any) => {
        toast({ 
          title: 'Update failed', 
          description: err?.data?.error || err?.message || 'Please try again', 
          variant: 'destructive' 
        });
      }
    }
  });

  const test = useTestOrangeSmsConnection({
    mutation: {
      onSuccess: (data) => {
        if (data.success) {
          toast({ title: 'Test SMS sent successfully' });
        } else {
          toast({ title: 'Test failed', description: data.message, variant: 'destructive' });
        }
        queryClient.invalidateQueries({ queryKey: getGetOrangeSmsConnectionQueryKey() });
        setTestPhone('');
      },
      onError: (err: any) => {
        toast({ 
          title: 'Test failed', 
          description: err?.data?.error || err?.message || 'Please try again', 
          variant: 'destructive' 
        });
      }
    }
  });

  const [form, setForm] = useState({
    clientId: '',
    clientSecret: '',
    senderAddress: '',
    senderName: '',
    isEnabled: false,
  });

  const [testPhone, setTestPhone] = useState('');

  useEffect(() => {
    if (connection) {
      setForm(prev => ({
        clientId: prev.clientId,
        clientSecret: prev.clientSecret,
        senderAddress: connection.senderAddress || '',
        senderName: connection.senderName || '',
        isEnabled: connection.isEnabled,
      }));
    }
  }, [connection]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: any = {
      isEnabled: form.isEnabled,
      senderAddress: form.senderAddress || null,
      senderName: form.senderName || null,
    };
    if (form.clientId.trim()) payload.clientId = form.clientId.trim();
    if (form.clientSecret.trim()) payload.clientSecret = form.clientSecret.trim();
    
    update.mutate({ data: payload });
  };

  const handleTest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPhone) return;
    test.mutate({ data: { phone: testPhone } });
  };

  return (
    <HqLayout title="API Connections">
      <div className="max-w-6xl space-y-6">
        <div className="mb-8">
          <p className="text-muted-foreground text-sm">
            Manage external infrastructure and third-party integrations required for the MobiCare network.
          </p>
        </div>

        {isLoading ? (
          <div className="space-y-6">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : connection ? (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
            <div className="xl:col-span-2 space-y-8">
              <form onSubmit={handleSubmit}>
                <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
                  <div className="px-6 py-5 border-b border-border bg-muted/20 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-[#FF6600]/10 flex items-center justify-center shrink-0">
                      <Signal className="w-5 h-5 text-[#FF6600]" />
                    </div>
                    <div>
                      <h2 className="font-semibold text-foreground">{connection.displayName}</h2>
                        <p className="text-[13px] text-muted-foreground mt-0.5">Add or edit the SMS gateway credentials and sender details at any time.</p>
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                      <Switch 
                        checked={form.isEnabled}
                        onCheckedChange={v => setForm({ ...form, isEnabled: v })}
                        disabled={update.isPending}
                        aria-label="Enable Orange SMS Connection"
                        id="enableConnection"
                      />
                      <Label htmlFor="enableConnection" className={cn("text-sm font-medium cursor-pointer", form.isEnabled ? "text-primary" : "text-muted-foreground")}>
                        {form.isEnabled ? 'Enabled' : 'Disabled'}
                      </Label>
                    </div>
                  </div>
                  
                  <div className="p-6 space-y-8">
                    <div className="space-y-6">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                          Authentication
                        </h3>
                        <div className="bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300 p-4 rounded-lg mb-6 flex gap-3 text-sm border border-blue-100 dark:border-blue-900">
                          <Info className="w-5 h-5 shrink-0" />
                          <div>
                            <p className="font-medium mb-1">Encrypted Storage</p>
                            <p className="opacity-90 leading-relaxed">
                              Credentials are encrypted at rest. For security, existing credentials are not displayed. 
                              Leave the fields blank to keep your current saved credentials unchanged.
                            </p>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <Label htmlFor="clientId">Client ID</Label>
                            <Input 
                              id="clientId"
                              value={form.clientId}
                              onChange={e => setForm({ ...form, clientId: e.target.value })}
                              placeholder={connection.credentialsConfigured ? "••••••••••••••••" : "Enter Client ID"}
                              autoComplete="off"
                            />
                          </div>
                          
                          <div className="space-y-2">
                            <Label htmlFor="clientSecret">Client Secret</Label>
                            <Input 
                              id="clientSecret"
                              type="password"
                              value={form.clientSecret}
                              onChange={e => setForm({ ...form, clientSecret: e.target.value })}
                              placeholder={connection.credentialsConfigured ? "••••••••••••••••" : "Enter Client Secret"}
                              autoComplete="new-password"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="pt-6 border-t border-border">
                        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                          <Cable className="w-4 h-4 text-muted-foreground" />
                          Sender Configuration
                        </h3>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <Label htmlFor="senderAddress">Sender Address (Phone)</Label>
                            <Input 
                              id="senderAddress"
                              value={form.senderAddress}
                              onChange={e => setForm({ ...form, senderAddress: e.target.value })}
                              placeholder="+232..."
                            />
                            <p className="text-[11px] text-muted-foreground">The registered E.164 phone number, e.g., +23276123456</p>
                          </div>
                          
                          <div className="space-y-2">
                            <Label htmlFor="senderName">Approved Sender Name</Label>
                            <Input 
                              id="senderName"
                              value={form.senderName}
                              onChange={e => setForm({ ...form, senderName: e.target.value })}
                              placeholder="MobiCare"
                              maxLength={11}
                            />
                            <p className="text-[11px] text-muted-foreground">Alphanumeric sender ID, max 11 characters.</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <div className="px-6 py-4 bg-muted/10 border-t border-border flex items-center justify-end gap-3">
                    <Button type="submit" disabled={update.isPending} className="min-w-[140px]">
                      {update.isPending ? (
                        <div className="h-4 w-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin mr-2" />
                      ) : (
                        <Save className="w-4 h-4 mr-2" />
                      )}
                      Save Configuration
                    </Button>
                  </div>
                </div>
              </form>
            </div>

            <div className="space-y-6">
              <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-muted/20">
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    <Activity className="w-4 h-4 text-muted-foreground" />
                    Connection Health
                  </h3>
                </div>
                <div className="p-6 space-y-5">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Overall Status</span>
                    <div className="flex items-center gap-2">
                      {connection.connectionStatus === 'ready' ? (
                        <><CheckCircle2 className="w-5 h-5 text-primary" /><span className="font-medium text-foreground">Ready to send</span></>
                      ) : connection.connectionStatus === 'incomplete' ? (
                        <><AlertCircle className="w-5 h-5 text-amber-500" /><span className="font-medium text-foreground">Configuration incomplete</span></>
                      ) : (
                        <><ShieldAlert className="w-5 h-5 text-muted-foreground" /><span className="font-medium text-foreground">Not configured</span></>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3 pt-3 border-t border-border">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Credentials Setup</span>
                      {connection.credentialsConfigured ? (
                        <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">Configured</span>
                      ) : (
                        <span className="text-xs font-medium bg-muted text-muted-foreground px-2 py-0.5 rounded-full">Missing</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Sender Details</span>
                      {connection.senderConfigured ? (
                        <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">Configured</span>
                      ) : (
                        <span className="text-xs font-medium bg-muted text-muted-foreground px-2 py-0.5 rounded-full">Missing</span>
                      )}
                    </div>
                  </div>

                  {connection.updatedAt && (
                    <p className="text-[11px] text-muted-foreground pt-3 border-t border-border">
                      Last updated {new Date(connection.updatedAt).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-border bg-muted/20">
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    <Signal className="w-4 h-4 text-muted-foreground" />
                    Test Connection
                  </h3>
                </div>
                <div className="p-6">
                  <form onSubmit={handleTest} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="testPhone">Test Phone Number</Label>
                      <Input 
                        id="testPhone"
                        placeholder="+232..."
                        value={testPhone}
                        onChange={e => setTestPhone(e.target.value)}
                        disabled={connection.connectionStatus !== 'ready'}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Requires a fully configured and enabled connection.
                      </p>
                    </div>
                    <Button 
                      type="submit" 
                      className="w-full" 
                      variant="secondary"
                      disabled={!testPhone.trim() || connection.connectionStatus !== 'ready' || test.isPending}
                    >
                      {test.isPending ? 'Sending Test SMS...' : 'Send Test SMS'}
                    </Button>
                  </form>

                  {(connection.lastTestedAt || connection.lastTestStatus) && (
                    <div className="mt-6 pt-5 border-t border-border space-y-3">
                      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Latest Test Result</h4>
                      <div className="rounded-lg border border-border p-3 bg-muted/30">
                        <div className="flex items-center gap-2 mb-2">
                          {connection.lastTestStatus === 'success' ? (
                            <CheckCircle2 className="w-4 h-4 text-primary" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-destructive" />
                          )}
                          <span className={cn("text-sm font-medium", connection.lastTestStatus === 'success' ? "text-primary" : "text-destructive")}>
                            {connection.lastTestStatus === 'success' ? 'Success' : 'Failed'}
                          </span>
                        </div>
                        {connection.lastTestMessage && (
                          <p className="text-xs text-muted-foreground line-clamp-3">
                            {connection.lastTestMessage}
                          </p>
                        )}
                        {connection.lastTestedAt && (
                          <p className="text-[10px] text-muted-foreground mt-2 font-mono">
                            {new Date(connection.lastTestedAt).toLocaleString()}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-12 text-center border border-border border-dashed rounded-xl text-muted-foreground">
            Failed to load connection data.
          </div>
        )}
      </div>
    </HqLayout>
  );
}
