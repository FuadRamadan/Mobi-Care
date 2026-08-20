import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useChangePassword } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lock, ShieldAlert } from "lucide-react";

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
  confirmPassword: z.string()
}).refine(data => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"]
});

export default function ChangePassword() {
  const { completePasswordChange, logout } = useAuth();
  const changePassword = useChangePassword();
  const [error, setError] = useState<{ message: string; policyErrors?: string[] } | null>(null);

  const form = useForm<z.infer<typeof passwordSchema>>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
      currentPassword: "",
      newPassword: "",
      confirmPassword: ""
    }
  });

  const onSubmit = async (values: z.infer<typeof passwordSchema>) => {
    setError(null);
    try {
      const result = await changePassword.mutateAsync({
        data: {
          currentPassword: values.currentPassword,
          newPassword: values.newPassword
        }
      });
      completePasswordChange(result);
    } catch (e: any) {
      const data = e.data;
      if (data?.code === 'TEMPORARY_PASSWORD_EXPIRED') {
        setError({
          message: "Your temporary password has expired. Please contact MobiCare HQ to issue a new one."
        });
      } else if (data?.messages && Array.isArray(data.messages)) {
        setError({
          message: data.error || "Password change failed.",
          policyErrors: data.messages
        });
      } else {
        setError({
          message: data?.error || e.message || "Failed to change password. Please check your current password."
        });
      }
    }
  };

  return (
    <div className="min-h-[100dvh] flex bg-background">
      <div className="flex-1 flex flex-col justify-center px-4 sm:px-6 lg:px-20 xl:px-24">
        <div className="mx-auto w-full max-w-md">
          <div className="flex flex-col items-center text-center">
            <div className="h-16 w-16 bg-primary/10 rounded-full flex items-center justify-center mb-6">
              <Lock className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              Secure Your Account
            </h2>
            <p className="mt-2 text-sm text-muted-foreground max-w-sm">
              You must set a new secure password before you can access the pharmacy portal.
            </p>
          </div>

          <div className="mt-10">
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {error && (
                  <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md flex gap-3">
                    <ShieldAlert className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm text-destructive font-medium">{error.message}</p>
                      {error.policyErrors && error.policyErrors.length > 0 && (
                        <ul className="mt-2 list-disc pl-4 text-xs text-destructive/90 space-y-1">
                          {error.policyErrors.map((msg, i) => (
                            <li key={i}>{msg}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
                
                <FormField
                  control={form.control}
                  name="currentPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Current or Temporary Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="••••••••" {...field} className="h-11" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="newPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>New Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="••••••••" {...field} className="h-11" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm New Password</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="••••••••" {...field} className="h-11" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="pt-2 flex gap-4">
                  <Button 
                    type="submit" 
                    className="flex-1 h-11 text-base font-semibold shadow-md"
                    disabled={changePassword.isPending}
                  >
                    {changePassword.isPending ? "Saving..." : "Save Password"}
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline"
                    className="h-11"
                    onClick={() => logout()}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </div>
      </div>
      <div className="hidden lg:block relative w-0 flex-1 bg-muted">
        <div className="absolute inset-0 h-full w-full bg-[#0B3D2E]">
          <div className="absolute inset-0 bg-gradient-to-br from-black/30 to-transparent" />
          <div className="flex items-center justify-center h-full">
            <div className="text-white/80 p-12 max-w-lg text-center">
              <ShieldAlert className="w-12 h-12 text-white/50 mx-auto mb-6" />
              <h1 className="text-4xl font-bold text-white mb-6">Security First</h1>
              <p className="text-lg leading-relaxed">
                MobiCare requires a strong, unique password to ensure patient data remains private and secure. 
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}