import { useState } from 'react';
import HqLayout from '../HqLayout';
import { Sidebar } from './Sidebar';
import { RequestEditor } from './RequestEditor';
import { OrangeSmsPanel } from './OrangeSmsPanel';
import { cn } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getListSavedApiRequestsQueryKey,
  useListSavedApiRequests,
} from '@workspace/api-client-react';

export default function HqApiConnections() {
  const [activeItem, setActiveItem] = useState<{ type: 'sms' } | { type: 'request', id: string }>({ type: 'sms' });
  const [isMobileList, setIsMobileList] = useState(true);
  const workspaceAccess = useListSavedApiRequests({
    query: { queryKey: getListSavedApiRequestsQueryKey(), retry: false },
  });

  const handleNavigate = (item: any) => {
    setActiveItem(item);
    setIsMobileList(false);
  };

  if (workspaceAccess.isLoading) {
    return (
      <HqLayout title="API Connections">
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          Checking API workspace access…
        </div>
      </HqLayout>
    );
  }

  if (workspaceAccess.isError) {
    return (
      <HqLayout title="API Connections">
        <div className="mx-auto max-w-xl rounded-xl border border-destructive/30 bg-card p-8 text-center">
          <h2 className="font-display text-xl font-bold text-dark-green">API workspace access restricted</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Your HQ account does not have permission to view or manage external API connections.
          </p>
        </div>
      </HqLayout>
    );
  }

  return (
    <HqLayout title="API Connections">
      <div className={cn(
        "flex border border-border rounded-xl bg-card overflow-hidden shadow-sm shadow-black/5",
        "h-[calc(100vh-8rem)] md:h-[calc(100vh-10rem)]"
      )}>
        <div className={cn(
          "w-full md:w-64 flex-col border-r border-border bg-card shrink-0",
          isMobileList ? "flex" : "hidden md:flex"
        )}>
          <Sidebar activeItem={activeItem} onNavigate={handleNavigate} />
        </div>
        
        <div className={cn(
          "flex-1 min-w-0 bg-background flex-col relative z-0",
          isMobileList ? "hidden md:flex" : "flex"
        )}>
          <div className="md:hidden flex items-center px-4 py-2 border-b border-border bg-card shrink-0 h-14">
            <Button variant="ghost" size="icon" onClick={() => setIsMobileList(true)} className="-ml-2 mr-2 text-muted-foreground shrink-0">
               <ArrowLeft className="w-5 h-5" />
            </Button>
            <span className="font-semibold text-sm truncate">
              {activeItem.type === 'sms' ? 'Orange SMS' : activeItem.id === 'new' ? 'New Request' : 'Edit Request'}
            </span>
          </div>

          {activeItem.type === 'sms' && <OrangeSmsPanel />}
          {activeItem.type === 'request' && <RequestEditor id={activeItem.id} onNavigate={handleNavigate} />}
        </div>
      </div>
    </HqLayout>
  );
}
