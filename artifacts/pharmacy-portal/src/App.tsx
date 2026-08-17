import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

import { AuthProvider } from '@/contexts/AuthContext';
import { Shell } from '@/components/layout/Shell';
import { setAuthTokenGetter } from '@workspace/api-client-react';

import Login from '@/pages/login';
import Dashboard from '@/pages/dashboard';
import Orders from '@/pages/orders';
import Inventory from '@/pages/inventory';
import Prescriptions from '@/pages/prescriptions';
import Profile from '@/pages/profile';
import Notifications from '@/pages/notifications';

// Setup auth token getter for api client
setAuthTokenGetter(() => localStorage.getItem('mc_access'));

const queryClient = new QueryClient();

function ProtectedRoutes() {
  return (
    <Shell>
      <Switch>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/orders" component={Orders} />
        <Route path="/inventory" component={Inventory} />
        <Route path="/prescriptions" component={Prescriptions} />
        <Route path="/profile" component={Profile} />
        <Route path="/notifications" component={Notifications} />
        {/* We want to catch not found within shell too ideally, or just root not found */}
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={() => {
          const [loc, setLoc] = useLocation();
          if (loc === '/') setLoc('/dashboard');
          return null;
        }} />
        <Route path="/login" component={Login} />
        <Route path="/:rest*">
          <ProtectedRoutes />
        </Route>
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <AuthProvider>
            <Router />
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
