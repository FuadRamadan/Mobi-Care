import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Redirect } from "wouter";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

const loginSchema = z.object({
  identifier: z.string().min(1, "Username or phone is required"),
  password: z.string().min(1, "Password is required"),
});

export default function Login() {
  const { login, user, isLoading } = useAuth();
  const [error, setError] = useState<string | null>(null);

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      identifier: "",
      password: "",
    },
  });

  if (isLoading) return null;
  if (user) return <Redirect to="/dashboard" />;

  const onSubmit = async (values: z.infer<typeof loginSchema>) => {
    setError(null);
    try {
      await login({ data: values });
    } catch (e: any) {
      setError(e.message || "Invalid credentials. Please try again.");
    }
  };

  return (
    <div className="min-h-[100dvh] flex bg-background">
      <div className="flex-1 flex flex-col justify-center px-4 sm:px-6 lg:px-20 xl:px-24">
        <div className="mx-auto w-full max-w-sm lg:w-96">
          <div>
            <img src={`${import.meta.env.BASE_URL}mobicare-pin.png`} alt="MobiCare Logo" className="h-16 w-auto object-contain mb-8" />
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              Pharmacy Portal
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Sign in to manage orders, inventory, and prescriptions.
            </p>
          </div>

          <div className="mt-10">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {error && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
                    <p className="text-sm text-destructive font-medium">{error}</p>
                  </div>
                )}
                
                <FormField
                  control={form.control}
                  name="identifier"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username or Phone</FormLabel>
                      <FormControl>
                        <Input placeholder="Enter your identifier" {...field} className="h-11" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="••••••••" {...field} className="h-11" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button 
                  type="submit" 
                  className="w-full h-11 text-base font-semibold shadow-md"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting ? "Signing in..." : "Sign in"}
                </Button>
              </form>
            </Form>
          </div>
        </div>
      </div>
      <div className="hidden lg:block relative w-0 flex-1 bg-muted">
        <div className="absolute inset-0 h-full w-full bg-[#0B3D2E]">
          {/* Subtle pattern or texture could go here. For now, solid brand green. */}
          <div className="absolute inset-0 bg-gradient-to-tr from-black/20 to-transparent" />
          <div className="flex items-center justify-center h-full">
            <div className="text-white/80 p-12 max-w-lg text-center">
              <h1 className="text-4xl font-bold text-white mb-6">Empowering Sierra Leone's Pharmacies</h1>
              <p className="text-lg leading-relaxed">
                MobiCare provides the tools you need to streamline operations, serve patients faster, and grow your business with confidence.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
