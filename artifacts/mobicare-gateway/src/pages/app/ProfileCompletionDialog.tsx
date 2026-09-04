import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePatientAuth } from '@/patient/auth';
import { useGetPatientProfile, getGetPatientProfileQueryKey, useUpdatePatientProfile } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

export function ProfileCompletionDialog() {
  const { user, profileCompletionPending, dismissProfileCompletion } = usePatientAuth();
  const queryClient = useQueryClient();

  const { data: profile } = useGetPatientProfile({
    query: {
      enabled: !!user && profileCompletionPending,
      queryKey: getGetPatientProfileQueryKey(),
    },
  });

  const updateProfile = useUpdatePatientProfile();

  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [nationality, setNationality] = useState('');
  const [nin, setNin] = useState('');

  const [isOpen, setIsOpen] = useState(false);

  // Initialize form when profile data loads
  useEffect(() => {
    if (profileCompletionPending && profile) {
      if (!profile.address || !profile.email || !profile.nationality) {
        setIsOpen(true);
        setAddress(profile.address || '');
        setEmail(profile.email || '');
        setNationality(profile.nationality || '');
        setNin(profile.nin || '');
      } else {
        dismissProfileCompletion();
      }
    } else {
      setIsOpen(false);
    }
  }, [profileCompletionPending, profile, dismissProfileCompletion]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    try {
      await updateProfile.mutateAsync({
        data: {
          address: address.trim(),
          email: email.trim(),
          nationality: nationality.trim(),
          nin: nin.trim() || null,
        },
      });
      queryClient.invalidateQueries({ queryKey: getGetPatientProfileQueryKey() });
      dismissProfileCompletion();
    } catch (err) {
      console.error(err);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      dismissProfileCompletion();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md bg-card">
        <DialogHeader>
          <DialogTitle className="font-display text-xl text-dark-green">Complete Your Registration</DialogTitle>
          <DialogDescription>
            Add your address, email, and nationality to finish setting up your patient profile.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="dialog-address">Address *</Label>
            <Input id="dialog-address" required value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St, Freetown" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dialog-email">Email *</Label>
            <Input id="dialog-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dialog-nationality">Nationality *</Label>
            <Input id="dialog-nationality" required value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="Sierra Leonean" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dialog-nin">NIN (Optional)</Label>
            <Input id="dialog-nin" value={nin} onChange={(e) => setNin(e.target.value)} placeholder="National Identification Number" />
          </div>
          <DialogFooter className="mt-6 flex-col sm:flex-row gap-2">
            <Button type="button" variant="outline" onClick={() => dismissProfileCompletion()} className="w-full sm:w-auto rounded-full">
              Not Now
            </Button>
            <Button type="submit" disabled={updateProfile.isPending} className="w-full sm:w-auto rounded-full">
              {updateProfile.isPending ? 'Saving...' : 'Save Profile'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}