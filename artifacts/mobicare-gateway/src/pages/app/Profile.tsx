import { useState, useRef, useEffect } from 'react';
import { Camera, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useGetPatientProfile, getGetPatientProfileQueryKey, useUpdatePatientProfile, useUpdatePatientProfilePhoto } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import { usePatientAuth } from '@/patient/auth';
import { PrivacyPanel } from './PrivacyPanel';

export default function PatientProfilePage() {
  const { user, updateUserName } = usePatientAuth();
  const { data: profile, isLoading } = useGetPatientProfile({
    query: {
      queryKey: getGetPatientProfileQueryKey(),
      enabled: !!user,
    }
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const updateProfile = useUpdatePatientProfile();
  const updatePhoto = useUpdatePatientProfilePhoto();

  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [nin, setNin] = useState('');
  const [address, setAddress] = useState('');
  const [email, setEmail] = useState('');
  const [nationality, setNationality] = useState('');

  // Sync state with profile data
  useEffect(() => {
    if (profile) {
      setName(profile.name || '');
      setNin(profile.nin || '');
      setAddress(profile.address || '');
      setEmail(profile.email || '');
      setNationality(profile.nationality || '');
    }
  }, [profile]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const updated = await updateProfile.mutateAsync({
        data: {
          name: name.trim(),
          nin: nin.trim() || null,
          address: address.trim() || null,
          email: email.trim() || null,
          nationality: nationality.trim() || null,
        }
      });
      queryClient.setQueryData(getGetPatientProfileQueryKey(), updated);
      updateUserName(updated.name);
      toast({
        title: "Profile updated",
        description: "Your profile has been saved successfully.",
      });
    } catch (err: any) {
      toast({
        title: "Update failed",
        description: err?.data?.error || err.message || "Failed to update profile",
        variant: "destructive"
      });
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast({
        title: "Unsupported image",
        description: "Choose a PNG, JPEG, or WebP image.",
        variant: "destructive",
      });
      return;
    }
    if (file.size === 0 || file.size > 5 * 1024 * 1024) {
      toast({
        title: "Image is too large",
        description: "Choose an image smaller than 5 MB.",
        variant: "destructive",
      });
      return;
    }

    // Convert to base64
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      try {
        const updated = await updatePhoto.mutateAsync({
          data: {
            image: base64
          }
        });
        queryClient.setQueryData(getGetPatientProfileQueryKey(), updated);
        toast({
          title: "Photo updated",
          description: "Your profile photo has been updated.",
        });
      } catch (err: any) {
        toast({
          title: "Upload failed",
          description: err?.data?.error || err.message || "Failed to upload photo",
          variant: "destructive"
        });
      }
    };
    reader.readAsDataURL(file);
    // clear input so same file can be selected again if needed
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-[50vh]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!profile) return null;

  return (
    <div className="space-y-6 max-w-xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
      <h1 className="text-2xl font-bold text-dark-green font-display">Your Profile</h1>
      
      <div className="bg-card border rounded-3xl p-6 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 left-0 right-0 h-2 bg-primary" />
        
        <div className="flex flex-col items-center mb-8 mt-2">
          <div className="relative mb-4">
            <div className="w-24 h-24 rounded-full overflow-hidden bg-secondary border-4 border-card shadow-sm flex items-center justify-center">
              {profile.profileImageUrl ? (
                <img src={profile.profileImageUrl} alt={`${profile.name}'s profile`} className="w-full h-full object-cover" />
              ) : (
                <UserIcon className="w-10 h-10 text-muted-foreground" />
              )}
            </div>
            <button 
              type="button"
              className="absolute bottom-0 right-0 p-2.5 bg-primary text-white rounded-full hover:bg-dark-green shadow-md transition-colors"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Upload photo"
            >
              <Camera className="w-4 h-4" />
            </button>
            <input 
              type="file" 
              ref={fileInputRef} 
              className="hidden" 
              accept="image/png, image/jpeg, image/webp" 
              onChange={handleFileChange}
            />
          </div>
          
          <div className="text-center">
            <p className="font-bold text-xl text-dark-green font-display">{profile.name}</p>
            <p className="text-sm font-medium text-muted-foreground mt-1">{profile.phone}</p>
            {profile.dateOfBirth && (
              <div className="inline-flex items-center mt-3 bg-secondary px-3 py-1 rounded-full text-xs font-medium text-dark-green">
                Born {new Date(profile.dateOfBirth).toLocaleDateString()} &bull; {profile.age} years old
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">Full Name</Label>
            <Input id="profile-name" value={name} onChange={e => setName(e.target.value)} required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="profile-address">Address</Label>
            <Input id="profile-address" value={address} onChange={e => setAddress(e.target.value)} placeholder="Your delivery address" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="profile-nationality">Nationality</Label>
            <Input id="profile-nationality" value={nationality} onChange={e => setNationality(e.target.value)} placeholder="e.g. Sierra Leonean" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="profile-nin">National Identification Number (NIN)</Label>
            <Input id="profile-nin" value={nin} onChange={e => setNin(e.target.value)} placeholder="Optional" />
          </div>

          <div className="pt-6">
            <Button 
              type="submit" 
              className="w-full rounded-full h-12 text-md"
              disabled={updateProfile.isPending || name.trim().length < 2}
            >
              {updateProfile.isPending ? 'Saving Changes...' : 'Save Changes'}
            </Button>
          </div>
        </form>

        <div className="mt-6">
          <PrivacyPanel />
        </div>
      </div>
    </div>
  );
}