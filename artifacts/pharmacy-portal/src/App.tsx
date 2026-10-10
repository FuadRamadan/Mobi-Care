import { lazy, Suspense, type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
// Every page shows its messages with sonner's toast(), so this is the toaster to mount.
import { Toaster } from '@/components/ui/sonner';
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
import { isInsideWarningWindow } from '@/utils/password';
import { freshAccessToken } from '@/lib/session';

const Login = lazy(() => import('@/pages/login'));
const ChangePassword = lazy(() => import('@/pages/change-password'));
const Dashboard = lazy(() => import('@/pages/dashboard'));
const Orders = lazy(() => import('@/pages/orders'));
const Inventory = lazy(() => import('@/pages/inventory'));
const Prescriptions = lazy(() => import('@/pages/prescriptions'));
const Profile = lazy(() => import('@/pages/profile'));
const Notifications = lazy(() => import('@/pages/notifications'));

// Every request gets a valid token: one about to expire is renewed first.
setAuthTokenGetter(freshAccessToken);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Data older than a few seconds is fetched again when the portal tab
      // comes back into view (for example after approving something in HQ),
      // instead of waiting for the next timed refresh, which browsers pause
      // while the tab is in the background.
      staleTime: 5_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
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
  const { user, passwordPolicy, isLoading } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return <RouteLoading />;
  }

  if (!user) {
    return <Redirect to="/login" />;
  }

  const isChangePasswordRoute = location === '/change-password';
  const insideWarningWindow = isInsideWarningWindow(user, passwordPolicy);
  const allowedToChange = user.mustChangePassword || insideWarningWindow;

  if (isChangePasswordRoute) {
    if (allowedToChange) {
      return (
        <Suspense fallback={<RouteLoading />}>
          <ChangePassword />
        </Suspense>
      );
    }
    return <Redirect to="/dashboard" />;
  }

  if (user.mustChangePassword) {
    return <Redirect to="/change-password" />;
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
