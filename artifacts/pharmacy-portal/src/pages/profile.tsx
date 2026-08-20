import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useChangePassword } from "@workspace/api-client-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, User, Phone, KeyRound, AlertCircle } from "lucide-react";
import { toast } from "sonner";

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
  confirmPassword: z.string()
}).refine(data => data.newPassword === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"]
});

export default function Profile() {
  const { user, completePasswordChange } = useAuth();
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

  if (!user) return null;

  const onSubmit = async (values: z.infer<typeof passwordSchema>) => {
    setError(null);
    try {
      const result = await changePassword.mutateAsync({
        data: {
          currentPassword: values.currentPassword,
          newPassword: values.newPassword
        }
      });
      toast.success("Password changed successfully");
      form.reset();
      completePasswordChange(result);
    } catch (e: any) {
      const data = e.data;
      if (data?.messages && Array.isArray(data.messages)) {
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
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pharmacy Profile</h1>
        <p className="text-muted-foreground mt-1 text-sm">Manage your pharmacy details and security settings.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1 space-y-6">
          <Card className="border-card-border shadow-sm">
            <CardHeader className="bg-muted/30 border-b border-card-border pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="w-5 h-5 text-primary" />
                Account Info
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <div>
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Pharmacy Name</Label>
                <p className="font-medium mt-1">{user.name}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground uppercase tracking-wider">Username</Label>
                <p className="font-medium mt-1 font-mono text-sm">{user.username}</p>
              </div>
              {user.phone && (
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <Phone className="w-3 h-3" /> Phone
                  </Label>
                  <p className="font-medium mt-1 text-sm">{user.phone}</p>
                </div>
              )}
              
              <div className="pt-2">
                {user.controlledSubstanceAuthorized ? (
                  <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200 flex items-center gap-1.5 w-fit">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    Authorized for Controlled Rx
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="flex items-center gap-1.5 w-fit">
                    Standard Rx Only
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-2">
          <Card className="border-card-border shadow-sm">
            <CardHeader className="bg-muted/30 border-b border-card-border pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <KeyRound className="w-5 h-5 text-primary" />
                Security
              </CardTitle>
              <CardDescription>Update your account password</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 max-w-md">
                  {error && (
                    <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-md flex gap-3 mb-4">
                      <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
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
                        <FormLabel>Current Password</FormLabel>
                        <FormControl>
                          <Input type="password" {...field} />
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
                          <Input type="password" {...field} />
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
                          <Input type="password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="pt-2">
                    <Button type="submit" disabled={changePassword.isPending}>
                      {changePassword.isPending ? "Updating..." : "Update Password"}
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Label({ children, className }: { children: React.ReactNode, className?: string }) {
  return <div className={className}>{children}</div>;
}
