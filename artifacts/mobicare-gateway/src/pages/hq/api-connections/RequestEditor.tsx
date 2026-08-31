import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Send, Save, MoreVertical, Copy, Trash, Loader2, Plus, X, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
   useGetSavedApiRequest,
   getGetSavedApiRequestQueryKey,
   useCreateSavedApiRequest,
   useUpdateSavedApiRequest,
   useDeleteSavedApiRequest,
   useDuplicateSavedApiRequest,
   useExecuteSavedApiRequest,
   useGetSavedApiRequestHistory,
   getListSavedApiRequestsQueryKey,
   getGetSavedApiRequestHistoryQueryKey,
   SavedApiRequestInputMethod,
   SavedApiRequestInputAuthType,
   SavedApiRequestInput,
   SavedApiExecution
} from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import { getMethodColor, formatJson } from './utils';

function KeyValueEditor({ items, onChange, label }: any) {
   const add = () => onChange([...items, { id: crypto.randomUUID(), key: '', value: '' }]);
   const update = (id: string, field: string, val: string) => onChange(items.map((i: any) => i.id === id ? { ...i, [field]: val } : i));
   const remove = (id: string) => onChange(items.filter((i: any) => i.id !== id));
   
   return (
      <div className="space-y-4 max-w-4xl pb-4">
         <div className="flex items-start gap-3 text-[11px] text-muted-foreground bg-muted/30 p-3 rounded border border-border">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
            <p className="leading-relaxed"><strong>{label} values are encrypted at rest.</strong> The API returns <code>••••••••</code> for existing non-empty values. Leave as-is to preserve, clear to remove, or type a new value to replace.</p>
         </div>
         <div className="space-y-2">
            {items.map((item: any) => (
               <div key={item.id} className="flex items-center gap-2">
                  <Input value={item.key} onChange={e => update(item.id, 'key', e.target.value)} placeholder="Key" className="font-mono text-[13px] h-10 md:h-9" />
                  <Input value={item.value} onChange={e => update(item.id, 'value', e.target.value)} placeholder="Value" className="font-mono text-[13px] h-10 md:h-9" />
                  <Button variant="ghost" size="icon" className="h-10 w-10 md:h-9 md:w-9 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => remove(item.id)}>
                     <X className="w-4 h-4" />
                  </Button>
               </div>
            ))}
            <Button variant="secondary" size="sm" onClick={add} className="text-xs h-9 md:h-8 mt-2">
               <Plus className="w-3 h-3 mr-1" /> Add Row
            </Button>
         </div>
      </div>
   );
}

function HistoryTab({ requestId }: { requestId?: string }) {
   const { data: history, isLoading } = useGetSavedApiRequestHistory(requestId || '', {
      query: { 
         enabled: !!requestId, 
         queryKey: getGetSavedApiRequestHistoryQueryKey(requestId || '') 
      }
   });

   if (!requestId) return <div className="text-muted-foreground text-sm p-4">Save the request to view history.</div>;
   
   if (isLoading) return <div className="p-4 text-sm text-muted-foreground">Loading history...</div>;
   if (!history?.length) return <div className="p-4 text-muted-foreground text-sm">No execution history yet.</div>;
   
   return (
      <div className="space-y-3 p-4">
         {history.map(h => (
            <div key={h.id} className="border border-border rounded-lg p-3 bg-background">
               <div className="flex items-center justify-between mb-2 gap-4">
                  <div className="flex items-center gap-3">
                     <span className={cn("text-xs font-bold w-10 shrink-0", getMethodColor(h.method!))}>{h.method}</span>
                     <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded shrink-0", h.status && h.status >= 200 && h.status < 300 ? "bg-green-500/10 text-green-600 dark:text-green-400" : "bg-destructive/10 text-destructive")}>
                        {h.status}
                     </span>
                  </div>
                  <span className="text-[10px] md:text-xs text-muted-foreground shrink-0 text-right">{new Date(h.createdAt!).toLocaleString()}</span>
               </div>
               <div className="text-xs font-mono text-muted-foreground truncate mb-2" title={h.url}>{h.url}</div>
               <div className="text-[11px] text-muted-foreground">Duration: {h.durationMs}ms</div>
            </div>
         ))}
      </div>
   );
}

export function RequestEditor({ id, onNavigate }: any) {
  const isNew = id === 'new';
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: request, isLoading } = useGetSavedApiRequest(id, {
    query: { enabled: !isNew, queryKey: getGetSavedApiRequestQueryKey(id) }
  });
  
  const [name, setName] = useState('Untitled Request');
  const [method, setMethod] = useState<SavedApiRequestInputMethod>(SavedApiRequestInputMethod.GET);
  const [url, setUrl] = useState('');
  const [authType, setAuthType] = useState<SavedApiRequestInputAuthType>(SavedApiRequestInputAuthType.none);
  const [auth, setAuth] = useState<{username?: string, headerName?: string, secret?: string}>({});
  const [params, setParams] = useState<{id: string, key: string, value: string}[]>([]);
  const [headers, setHeaders] = useState<{id: string, key: string, value: string}[]>([]);
  const [body, setBody] = useState('');
  
  const [lastExecution, setLastExecution] = useState<SavedApiExecution | null>(null);
  const [responseTab, setResponseTab] = useState('body');
  
  const initializedForId = useRef<string | null>(null);
  
  useEffect(() => {
     if (isNew && initializedForId.current !== 'new') {
        initializedForId.current = 'new';
        setName('Untitled Request');
        setMethod(SavedApiRequestInputMethod.GET);
        setUrl('');
        setAuthType(SavedApiRequestInputAuthType.none);
        setAuth({});
        setParams([]);
        setHeaders([]);
        setBody('');
        setLastExecution(null);
        setResponseTab('body');
     } else if (request && initializedForId.current !== id) {
        initializedForId.current = id;
        setName(request.name);
        setMethod(request.method as SavedApiRequestInputMethod);
        setUrl(request.url);
        setAuthType(request.authType || SavedApiRequestInputAuthType.none);
        setAuth({ username: request.auth?.username, headerName: request.auth?.headerName, secret: '' });
        setParams(request.params?.map(p => ({ id: crypto.randomUUID(), key: p.key, value: p.value })) || []);
        setHeaders(request.headers?.map(h => ({ id: crypto.randomUUID(), key: h.key, value: h.value })) || []);
        setBody(request.body || '');
        setLastExecution(null);
        setResponseTab('body');
     }
  }, [id, request, isNew]);

  const createReq = useCreateSavedApiRequest();
  const updateReq = useUpdateSavedApiRequest();
  const deleteReq = useDeleteSavedApiRequest();
  const duplicateReq = useDuplicateSavedApiRequest();
  const executeReq = useExecuteSavedApiRequest();

  const getPayload = (): SavedApiRequestInput => {
     const p: SavedApiRequestInput = {
        name,
        method,
        url,
        authType: authType === SavedApiRequestInputAuthType.none ? undefined : authType,
        auth: authType !== SavedApiRequestInputAuthType.none ? {
           username: auth.username || undefined,
           headerName: auth.headerName || undefined,
           secret: auth.secret || undefined
        } : undefined,
        params: params.filter(p => p.key.trim() !== '').map(p => ({ key: p.key.trim(), value: p.value })),
        headers: headers.filter(h => h.key.trim() !== '').map(h => ({ key: h.key.trim(), value: h.value })),
        body: body.trim() ? body : null
     };
     if (p.auth && !p.auth.secret) {
        delete p.auth.secret;
     }
     return p;
  };

  const handleSave = async (silent = false) => {
     if (!url.trim()) {
        if (!silent) toast({ title: 'URL is required', variant: 'destructive' });
        return null;
     }
     if (!name.trim()) {
        if (!silent) toast({ title: 'Name is required', variant: 'destructive' });
        return null;
     }
     
     const payload = getPayload();
     
     if (isNew) {
        try {
           const res = await createReq.mutateAsync({ data: payload });
           queryClient.invalidateQueries({ queryKey: getListSavedApiRequestsQueryKey() });
           if (!silent) toast({ title: 'Request created' });
           onNavigate({ type: 'request', id: res.id });
           return res.id;
        } catch (e: any) {
           if (!silent) toast({ title: 'Failed to create request', description: e.message, variant: 'destructive' });
           return null;
        }
     } else {
        try {
           await updateReq.mutateAsync({ id, data: payload });
           queryClient.invalidateQueries({ queryKey: getListSavedApiRequestsQueryKey() });
           if (!silent) toast({ title: 'Request saved' });
           return id;
        } catch (e: any) {
           if (!silent) toast({ title: 'Failed to save request', description: e.message, variant: 'destructive' });
           return null;
        }
     }
  };

  const handleSend = async () => {
     if (!url.trim()) {
        toast({ title: 'URL is required', variant: 'destructive' });
        return;
     }
     
     let targetId = id;
     // Always auto-save before sending
     const savedId = await handleSave(true);
     if (!savedId) {
         toast({ title: 'Could not save request before sending.', variant: 'destructive' });
         return;
     }
     targetId = savedId;
     
     try {
        const result = await executeReq.mutateAsync({ id: targetId });
        setLastExecution(result);
        setResponseTab('body');
        queryClient.invalidateQueries({ queryKey: getGetSavedApiRequestHistoryQueryKey(targetId) });
     } catch (e: any) {
        toast({ title: 'Execution failed', description: e?.data?.error || e.message, variant: 'destructive' });
     }
  };

  const handleDelete = () => {
     if (confirm('Are you sure you want to delete this request?')) {
        deleteReq.mutate({ id }, {
           onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: getListSavedApiRequestsQueryKey() });
              toast({ title: 'Request deleted' });
              onNavigate({ type: 'sms' });
           }
        });
     }
  };

  const handleDuplicate = () => {
     duplicateReq.mutate({ id }, {
        onSuccess: (res) => {
           queryClient.invalidateQueries({ queryKey: getListSavedApiRequestsQueryKey() });
           toast({ title: 'Request duplicated' });
           onNavigate({ type: 'request', id: res.id });
        }
     });
  };

  if (!isNew && isLoading) {
     return <div className="p-8 text-center text-muted-foreground flex items-center justify-center h-full"><Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...</div>;
  }

  const isSaving = createReq.isPending || updateReq.isPending;
  const isSending = executeReq.isPending;

  return (
     <div className="flex flex-col h-full bg-background relative">
        <div className="flex items-center gap-2 px-3 md:px-4 py-2.5 border-b border-border bg-card shrink-0">
           <Input 
              value={name} 
              onChange={e => setName(e.target.value)} 
              className="font-semibold bg-transparent border-transparent hover:border-input focus:border-input px-2 min-w-[120px] max-w-[200px] md:max-w-xs shadow-none focus-visible:ring-1" 
              placeholder="Request Name"
           />
           <div className="flex-1" />
           {!isNew && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                   <Button variant="ghost" size="icon" className="h-9 w-9 md:h-8 md:w-8 shrink-0"><MoreVertical className="w-4 h-4 md:w-4 md:h-4" /></Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                   <DropdownMenuItem onClick={handleDuplicate}><Copy className="w-4 h-4 mr-2" /> Duplicate</DropdownMenuItem>
                   <DropdownMenuSeparator />
                   <DropdownMenuItem onClick={handleDelete} className="text-destructive"><Trash className="w-4 h-4 mr-2" /> Delete</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
           )}
           <Button variant="secondary" size="sm" onClick={() => handleSave(false)} disabled={isSaving} className="shrink-0 h-9 md:h-8">
              {isSaving ? <Loader2 className="w-4 h-4 md:mr-2 animate-spin" /> : <Save className="w-4 h-4 md:mr-2" />} 
              <span className="hidden md:inline">Save</span>
           </Button>
        </div>
        
        <div className="px-3 md:px-4 py-2.5 flex flex-wrap md:flex-nowrap items-center gap-2 border-b border-border bg-muted/20 shrink-0">
           <Select value={method} onValueChange={(v: any) => setMethod(v)}>
              <SelectTrigger className={cn("w-[90px] md:w-[110px] font-bold h-10 bg-background shrink-0", getMethodColor(method))}>
                 <SelectValue />
              </SelectTrigger>
              <SelectContent>
                 {Object.values(SavedApiRequestInputMethod).map(m => (
                    <SelectItem key={m} value={m} className={cn("font-bold", getMethodColor(m))}>{m}</SelectItem>
                 ))}
              </SelectContent>
           </Select>
           <Input 
              value={url} 
              onChange={e => setUrl(e.target.value)} 
              placeholder="https://api.example.com/v1/resource" 
              className="flex-1 min-w-[150px] font-mono text-[13px] h-10 bg-background" 
           />
           <Button onClick={handleSend} disabled={isSending || isSaving} className="w-full md:w-[100px] h-10 bg-primary hover:bg-primary/90 text-primary-foreground shrink-0 mt-1 md:mt-0">
              {isSending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />} 
              Send
           </Button>
        </div>

        <div className="flex-1 min-h-0">
           <PanelGroup direction="vertical">
              <Panel defaultSize={50} minSize={20} className="flex flex-col">
                 <Tabs defaultValue="params" className="flex-1 flex flex-col min-h-0">
                    <div className="px-2 md:px-4 border-b border-border bg-card shrink-0 flex items-center overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                       <TabsList className="bg-transparent h-12 p-0 border-b-0 space-x-2 md:space-x-6 flex justify-start w-max">
                          <TabsTrigger value="params" className="whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent px-3 md:px-1">Params {params.length > 0 && <span className="ml-1 text-[10px] text-muted-foreground">({params.length})</span>}</TabsTrigger>
                          <TabsTrigger value="headers" className="whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent px-3 md:px-1">Headers {headers.length > 0 && <span className="ml-1 text-[10px] text-muted-foreground">({headers.length})</span>}</TabsTrigger>
                          <TabsTrigger value="auth" className="whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent px-3 md:px-1 flex items-center gap-1">Auth {authType !== 'none' && <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />}</TabsTrigger>
                          <TabsTrigger value="body" className="whitespace-nowrap rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent px-3 md:px-1 flex items-center gap-1">Body {body.trim() && <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />}</TabsTrigger>
                       </TabsList>
                    </div>
                    <div className="flex-1 overflow-auto bg-background p-3 md:p-4">
                       <TabsContent value="params" className="m-0 h-full"><KeyValueEditor label="Parameter" items={params} onChange={setParams} /></TabsContent>
                       <TabsContent value="headers" className="m-0 h-full"><KeyValueEditor label="Header" items={headers} onChange={setHeaders} /></TabsContent>
                       <TabsContent value="auth" className="m-0 h-full">
                          <div className="space-y-4 md:space-y-5 max-w-xl bg-card p-4 md:p-5 rounded-xl border border-border">
                             <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                                <Label className="w-auto md:w-24 shrink-0 md:text-right font-medium text-xs md:text-sm">Auth Type</Label>
                                <Select value={authType} onValueChange={(v: any) => setAuthType(v)}>
                                   <SelectTrigger className="flex-1 h-10 md:h-9">
                                      <SelectValue />
                                   </SelectTrigger>
                                   <SelectContent>
                                      <SelectItem value={SavedApiRequestInputAuthType.none}>No Auth</SelectItem>
                                      <SelectItem value={SavedApiRequestInputAuthType.basic}>Basic Auth</SelectItem>
                                      <SelectItem value={SavedApiRequestInputAuthType.bearer}>Bearer Token</SelectItem>
                                      <SelectItem value={SavedApiRequestInputAuthType['api-key-header']}>API Key</SelectItem>
                                   </SelectContent>
                                </Select>
                             </div>
                             
                             {authType === SavedApiRequestInputAuthType.basic && (
                                <>
                                   <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                                      <Label className="w-auto md:w-24 shrink-0 md:text-right font-medium text-xs md:text-sm">Username</Label>
                                      <Input value={auth.username || ''} onChange={e => setAuth({...auth, username: e.target.value})} className="flex-1 h-10 md:h-9" />
                                   </div>
                                   <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                                      <Label className="w-auto md:w-24 shrink-0 md:text-right font-medium text-xs md:text-sm">Password</Label>
                                      <Input type="password" value={auth.secret || ''} onChange={e => setAuth({...auth, secret: e.target.value})} placeholder={request?.authConfigured ? '••••••••' : ''} className="flex-1 h-10 md:h-9" />
                                   </div>
                                </>
                             )}
                             
                             {authType === SavedApiRequestInputAuthType.bearer && (
                                <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                                   <Label className="w-auto md:w-24 shrink-0 md:text-right font-medium text-xs md:text-sm">Token</Label>
                                   <Input type="password" value={auth.secret || ''} onChange={e => setAuth({...auth, secret: e.target.value})} placeholder={request?.authConfigured ? '••••••••' : ''} className="flex-1 h-10 md:h-9 font-mono text-xs" />
                                </div>
                             )}
                             
                             {authType === SavedApiRequestInputAuthType['api-key-header'] && (
                                <>
                                   <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                                      <Label className="w-auto md:w-24 shrink-0 md:text-right font-medium text-xs md:text-sm">Header</Label>
                                      <Input value={auth.headerName || ''} onChange={e => setAuth({...auth, headerName: e.target.value})} placeholder="e.g. x-api-key" className="flex-1 h-10 md:h-9 font-mono text-xs" />
                                   </div>
                                   <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                                      <Label className="w-auto md:w-24 shrink-0 md:text-right font-medium text-xs md:text-sm">Value</Label>
                                      <Input type="password" value={auth.secret || ''} onChange={e => setAuth({...auth, secret: e.target.value})} placeholder={request?.authConfigured ? '••••••••' : ''} className="flex-1 h-10 md:h-9 font-mono text-xs" />
                                   </div>
                                </>
                             )}
                             
                             {authType !== SavedApiRequestInputAuthType.none && request?.authConfigured && (
                                <div className="md:ml-28 flex items-start gap-2 text-[11px] text-muted-foreground bg-muted/30 p-2.5 rounded border border-border">
                                   <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                   <p>The secret value is encrypted at rest and not displayed. Leave the secret field blank to keep your existing saved value.</p>
                                </div>
                             )}
                          </div>
                       </TabsContent>
                       <TabsContent value="body" className="m-0 h-full pb-8">
                          <textarea 
                             value={body} 
                             onChange={e => setBody(e.target.value)} 
                             className="w-full h-full resize-none font-mono text-[13px] bg-transparent border-0 focus:ring-0 outline-none leading-relaxed"
                             placeholder="{\n  &#34;key&#34;: &#34;value&#34;\n}"
                             spellCheck={false}
                          />
                       </TabsContent>
                    </div>
                 </Tabs>
              </Panel>
              
              <PanelResizeHandle className="h-2 relative bg-border/50 hover:bg-primary/50 transition-colors cursor-row-resize flex items-center justify-center">
                 <div className="w-8 h-1 bg-border rounded-full" />
              </PanelResizeHandle>
              
              <Panel defaultSize={50} minSize={20} className="flex flex-col bg-background border-t border-border">
                 <div className="flex flex-col h-full min-h-0">
                    <div className="flex items-center justify-between px-2 md:px-4 border-b border-border bg-card shrink-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                       <Tabs value={responseTab} onValueChange={setResponseTab} className="flex-1 flex justify-between h-12 items-center min-w-max">
                          <div className="flex items-center gap-4 md:gap-6">
                             <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hidden md:inline">Response</span>
                             <TabsList className="bg-transparent p-0 h-auto space-x-2 md:space-x-4">
                                <TabsTrigger value="body" className="text-xs data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary px-2 border-b-2 border-transparent data-[state=active]:border-primary rounded-none h-12">Body</TabsTrigger>
                                <TabsTrigger value="headers" className="text-xs data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary px-2 border-b-2 border-transparent data-[state=active]:border-primary rounded-none h-12">Headers</TabsTrigger>
                                <TabsTrigger value="history" className="text-xs data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-primary px-2 border-b-2 border-transparent data-[state=active]:border-primary rounded-none h-12">History</TabsTrigger>
                             </TabsList>
                          </div>
                          {lastExecution && responseTab !== 'history' && (
                             <div className="flex items-center gap-3 text-xs font-mono pl-4 pr-2">
                                <span className={cn("font-bold", lastExecution.status >= 200 && lastExecution.status < 300 ? "text-green-600 dark:text-green-400" : "text-destructive")}>
                                   {lastExecution.status}
                                </span>
                                <span className="text-muted-foreground">
                                   {lastExecution.durationMs}ms
                                </span>
                             </div>
                          )}
                       </Tabs>
                    </div>
                    
                    <div className="flex-1 overflow-auto bg-muted/10">
                       {responseTab === 'history' ? (
                          <HistoryTab requestId={isNew ? undefined : id} />
                       ) : !lastExecution ? (
                          <div className="h-full flex items-center justify-center text-muted-foreground text-sm font-sans flex-col gap-3">
                             <Send className="w-8 h-8 opacity-20" />
                             <p>Enter the URL and click Send to get a response</p>
                          </div>
                       ) : (
                          <div className="p-4 font-mono text-[12px] leading-relaxed">
                             {responseTab === 'body' && (
                                <pre className="whitespace-pre-wrap break-words">{formatJson(lastExecution.body || '')}</pre>
                             )}
                             {responseTab === 'headers' && (
                                <div className="space-y-1.5">
                                   {Object.entries(lastExecution.headers || {}).map(([k, v]) => (
                                      <div key={k} className="flex gap-4">
                                         <span className="font-semibold text-primary/80 min-w-[150px] shrink-0">{k}:</span>
                                         <span className="break-all">{v}</span>
                                      </div>
                                   ))}
                                </div>
                             )}
                          </div>
                       )}
                    </div>
                 </div>
              </Panel>
           </PanelGroup>
        </div>
     </div>
  );
}
