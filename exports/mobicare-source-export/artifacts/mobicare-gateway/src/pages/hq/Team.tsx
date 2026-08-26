import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListHqTeamMembersQueryKey,
  getListTeamMembersQueryKey,
  useListHqTeamMembers,
  useRequestHqTeamPhotoUpload,
  useUpdateHqTeamMemberPhoto,
} from "@workspace/api-client-react";
import { Camera, ImagePlus, Users } from "lucide-react";
import HqLayout from "./HqLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export default function HqTeam() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: members = [], isLoading } = useListHqTeamMembers({
    query: { queryKey: getListHqTeamMembersQueryKey() },
  });
  const requestUpload = useRequestHqTeamPhotoUpload();
  const savePhoto = useUpdateHqTeamMemberPhoto();
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListHqTeamMembersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListTeamMembersQueryKey() });
  };

  const uploadPhoto = async (memberId: string, file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type) || file.size > MAX_FILE_BYTES) {
      toast({
        title: "Choose a JPG, PNG, or WebP under 5 MB",
        variant: "destructive",
      });
      return;
    }

    setUploadingId(memberId);
    try {
      const upload = await requestUpload.mutateAsync({
        id: memberId,
        data: { contentType: file.type as "image/jpeg" | "image/png" | "image/webp", fileSize: file.size },
      });
      const response = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) {
        throw new Error("The image upload could not be completed.");
      }

      await savePhoto.mutateAsync({ id: memberId, data: { objectPath: upload.objectPath } });
      refresh();
      toast({ title: "Team photo updated", description: "The new portrait is now live on the About page." });
    } catch (error) {
      toast({
        title: "Photo update failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUploadingId(null);
    }
  };

  return (
    <HqLayout title="Team Profiles">
      <div className="max-w-5xl space-y-6">
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
          <div className="flex gap-3">
            <Users className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <h2 className="font-semibold text-dark-green">Public About page portraits</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Upload a square or portrait JPG, PNG, or WebP image (up to 5 MB). Changes go live as soon as the upload finishes.
              </p>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-80 animate-pulse rounded-xl border bg-muted/40" />
            ))}
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((member) => {
              const isUploading = uploadingId === member.id;
              const inputId = `team-photo-${member.id}`;
              return (
                <article key={member.id} className="overflow-hidden rounded-xl border bg-card shadow-sm">
                  <div className="aspect-square bg-muted">
                    {member.photoUrl ? (
                      <img
                        src={member.photoUrl}
                        alt={member.name}
                        className="h-full w-full object-cover object-top"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        No portrait uploaded
                      </div>
                    )}
                  </div>
                  <div className="space-y-4 p-5">
                    <div>
                      <h2 className="font-semibold text-dark-green">{member.name}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">{member.role}</p>
                    </div>
                    <Input
                      id={inputId}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="sr-only"
                      disabled={isUploading}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.currentTarget.value = "";
                        if (file) void uploadPhoto(member.id, file);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={isUploading}
                      onClick={() => document.getElementById(inputId)?.click()}
                      data-testid={`button-upload-team-photo-${member.id}`}
                    >
                      {isUploading ? <Camera className="animate-pulse" /> : <ImagePlus />}
                      {isUploading ? "Uploading…" : member.photoUrl ? "Replace photo" : "Upload photo"}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </HqLayout>
  );
}