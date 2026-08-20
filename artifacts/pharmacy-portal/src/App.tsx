import { lazy, Suspense, type ReactNode, useEffect } from 'react';
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
  Redirect,
} from 'wouter';

import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { Shell } from '@/components/layout/Shell';
import { setAuthTokenGetter } from '@workspace/api-client-react';

const Login = lazy(() => import('@/pages/login'));
const ChangePassword = lazy(() => import('@/pages/change-password'));
const Dashboard = lazy(() => import('@/pages/dashboard'));
const Orders = lazy(() => import('@/pages/orders'));
const Inventory = lazy(() => import('@/pages/inventory'));
const Prescriptions = lazy(() => import('@/pages/prescriptions'));
const Profile = lazy(() => import('@/pages/profile'));
const Notifications = lazy(() => import('@/pages/notifications'));

// Setup auth token getter for api client
setAuthTokenGetter(() => localStorage.getItem('mc_access'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function RouteLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading page">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function ProtectedRoutes() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <RouteLoading />;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  if (user.mustChangePassword) {
    return (
      <Suspense fallback={<RouteLoading />}>
        <Switch>
          <Route path="/change-password" component={ChangePassword} />
          <Route component={() => <Redirect to="/change-password" />} />
        </Switch>
      </Suspense>
    );
  }

  return (
    <Shell>
      <Suspense fallback={<RouteLoading />}>
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
      </Suspense>
    </Shell>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Suspense fallback={<RouteLoading />}>
        <Switch>
          <Route path="/" component={() => {
            const [, setLoc] = useLocation();
            useEffect(() => { setLoc('/dashboard'); }, [setLoc]);
            return null;
          }} />
          <Route path="/login" component={Login} />
          <Route path="/:rest*">
            <ProtectedRoutes />
          </Route>
        </Switch>
      </Suspense>
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
