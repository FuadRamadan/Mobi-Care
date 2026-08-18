import { type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import NotFound from '@/pages/not-found';
import Home from '@/pages/Home';
import About from '@/pages/About';
import Patient from '@/pages/Patient';
import Pharmacy from '@/pages/Pharmacy';
import Layout from '@/components/layout/Layout';
import { HqAuthProvider } from '@/hq/auth';
import HqLogin from '@/pages/hq/Login';
import HqDashboard from '@/pages/hq/Dashboard';
import HqOrders from '@/pages/hq/Orders';
import HqDispatch from '@/pages/hq/Dispatch';
import HqPharmacies from '@/pages/hq/Pharmacies';
import HqCatalogue from '@/pages/hq/Catalogue';
import HqCouriers from '@/pages/hq/Couriers';
import HqFlags from '@/pages/hq/Flags';
import HqSettlements from '@/pages/hq/Settlements';
import HqAudit from '@/pages/hq/Audit';

const queryClient = new QueryClient();

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
          <Route path="/hq/flags" component={HqFlags} />
          <Route path="/hq/settlements" component={HqSettlements} />
          <Route path="/hq/audit" component={HqAudit} />
          <Route component={NotFound} />
        </Switch>
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
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
        </HqAuthProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
