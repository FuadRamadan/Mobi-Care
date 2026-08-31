import { useListSavedApiRequests } from '@workspace/api-client-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Plus, Signal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getMethodColor } from './utils';

export function Sidebar({ activeItem, onNavigate }: any) {
  const { data: requests, isLoading } = useListSavedApiRequests();
  
  return (
    <div className="flex flex-col h-full bg-card">
      <div className="p-3 border-b border-border space-y-3">
        <Button className="w-full justify-start h-10 text-sm bg-primary/10 text-primary hover:bg-primary/20" variant="ghost" onClick={() => onNavigate({ type: 'request', id: 'new' })}>
          <Plus className="w-4 h-4 mr-2" /> New Request
        </Button>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-2 mt-1">
            Integrations
          </div>
          <button 
            onClick={() => onNavigate({ type: 'sms' })}
            className={cn("w-full flex items-center px-3 py-2.5 text-sm rounded-md transition-colors", activeItem.type === 'sms' ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted text-foreground")}
          >
            <Signal className="w-4 h-4 mr-2 shrink-0" /> <span className="truncate">Orange SMS</span>
          </button>
          
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-2 py-2 mt-4">
            Saved Requests
          </div>
          {isLoading ? (
            <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin shrink-0" /> Loading...
            </div>
          ) : !requests?.length ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">No saved requests.</div>
          ) : (
            requests.map(req => (
              <button
                key={req.id}
                onClick={() => onNavigate({ type: 'request', id: req.id })}
                className={cn("w-full flex items-center px-3 py-2.5 text-sm rounded-md transition-colors text-left", activeItem.type === 'request' && activeItem.id === req.id ? "bg-muted text-foreground font-medium" : "hover:bg-muted/50 text-muted-foreground")}
              >
                <span className={cn("text-[10px] font-bold w-12 shrink-0", getMethodColor(req.method))}>{req.method}</span>
                <span className="truncate flex-1">{req.name}</span>
              </button>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
