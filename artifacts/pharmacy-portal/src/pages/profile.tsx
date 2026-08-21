import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck, User, Phone } from "lucide-react";

export default function Profile() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Pharmacy Profile</h1>
        <p className="text-muted-foreground mt-1 text-sm">View your pharmacy account details.</p>
      </div>

      <Card className="max-w-lg border-card-border shadow-sm">
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
  );
}

function Label({ children, className }: { children: React.ReactNode, className?: string }) {
  return <div className={className}>{children}</div>;
}
