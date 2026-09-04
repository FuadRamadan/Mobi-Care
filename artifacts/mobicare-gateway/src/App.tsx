import { lazy, Suspense, type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import NotFound from '@/pages/not-found';
import Home from '@/pages/Home';
import Layout from '@/components/layout/Layout';
import '@/lib/portalToken';
import { HqAuthProvider } from '@/hq/auth';
import { PatientAuthProvider } from '@/patient/auth';
import { CartProvider } from '@/patient/cart';

// Route-only pages stay out of the first public bundle. Vite keeps shared
// dependencies in reusable chunks, so returning visitors do not re-download them.
const About = lazy(() => import('@/pages/About'));
const Patient = lazy(() => import('@/pages/Patient'));
const Pharmacy = lazy(() => import('@/pages/Pharmacy'));
const PatientLogin = lazy(() => import('@/pages/app/Login'));
const AppLayout = lazy(() => import('@/pages/app/AppLayout'));
const PatientProfile = lazy(() => import('@/pages/app/Profile'));
const PatientSearch = lazy(() => import('@/pages/app/Search'));
const Checkout = lazy(() => import('@/pages/app/Checkout'));
const PatientOrders = lazy(() => import('@/pages/app/Orders'));
const OrderDetail = lazy(() => import('@/pages/app/OrderDetail'));
const NotificationsPage = lazy(() => import('@/pages/app/Notifications'));
const HqLogin = lazy(() => import('@/pages/hq/Login'));
const HqDashboard = lazy(() => import('@/pages/hq/Dashboard'));
const HqOrders = lazy(() => import('@/pages/hq/Orders'));
const HqDispatch = lazy(() => import('@/pages/hq/Dispatch'));
const HqPharmacies = lazy(() => import('@/pages/hq/Pharmacies'));
const HqCatalogue = lazy(() => import('@/pages/hq/Catalogue'));
const HqCouriers = lazy(() => import('@/pages/hq/Couriers'));
const HqAdvertisements = lazy(() => import('@/pages/hq/Advertisements'));
const HqFlags = lazy(() => import('@/pages/hq/Flags'));
const HqSettlements = lazy(() => import('@/pages/hq/Settlements'));
const HqAudit = lazy(() => import('@/pages/hq/Audit'));
const HqSettings = lazy(() => import('@/pages/hq/Settings'));
const HqTeam = lazy(() => import('@/pages/hq/Team'));
const HqApiConnections = lazy(() => import('@/pages/hq/ApiConnections'));
const HqInsights = lazy(() => import('@/pages/hq/Insights'));

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
    <div className="flex min-h-[14rem] items-center justify-center" role="status" aria-label="Loading page">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

// Scroll to top on route change
function ScrollToTop() {
  const [pathname] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <ScrollToTop />
      <Layout>
        <Suspense fallback={<RouteLoading />}>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/about" component={About} />
            <Route path="/patient" component={Patient} />
            <Route path="/pharmacy" component={Pharmacy} />
            {/* HQ section — same site, own layout (Layout renders bare for /hq*) */}
            <Route path="/hq" component={HqLogin} />
            <Route path="/hq/dashboard" component={HqDashboard} />
            <Route path="/hq/orders" component={HqOrders} />
            <Route path="/hq/dispatch" component={HqDispatch} />
            <Route path="/hq/pharmacies" component={HqPharmacies} />
            <Route path="/hq/catalogue" component={HqCatalogue} />
            <Route path="/hq/couriers" component={HqCouriers} />
            <Route path="/hq/advertisements" component={HqAdvertisements} />
            <Route path="/hq/flags" component={HqFlags} />
            <Route path="/hq/settlements" component={HqSettlements} />
            <Route path="/hq/audit" component={HqAudit} />
            <Route path="/hq/settings" component={HqSettings} />
            <Route path="/hq/team" component={HqTeam} />
            <Route path="/hq/api-connections" component={HqApiConnections} />
            <Route path="/hq/insights" component={HqInsights} />
            {/* Patient app — same site, own shell (Layout renders bare for /app*) */}
            <Route path="/app" component={PatientLogin} />
            <Route path="/app/profile">
              <AppLayout><PatientProfile /></AppLayout>
            </Route>
            <Route path="/app/search">
              <AppLayout><PatientSearch /></AppLayout>
            </Route>
            <Route path="/app/checkout">
              <AppLayout><Checkout /></AppLayout>
            </Route>
            <Route path="/app/orders">
              <AppLayout><PatientOrders /></AppLayout>
            </Route>
            <Route path="/app/orders/:id">
              <AppLayout><OrderDetail /></AppLayout>
            </Route>
            <Route path="/app/notifications">
              <AppLayout><NotificationsPage /></AppLayout>
            </Route>
            <Route component={NotFound} />
          </Switch>
        </Suspense>
      </Layout>
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
        <HqAuthProvider>
          <PatientAuthProvider>
            <CartProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
                <Router />
              </WouterRouter>
            </CartProvider>
          </PatientAuthProvider>
        </HqAuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
