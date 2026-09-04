import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  getListHqAdvertisementsQueryKey,
  useListHqAdvertisements,
  useRequestHqAdvertisementUpload,
  useCreateHqAdvertisement,
  useUpdateHqAdvertisement,
  useDeleteHqAdvertisement,
  type HqAdvertisement,
} from "@workspace/api-client-react";
import {
  Plus,
  Pencil,
  Trash2,
  Image as ImageIcon,
  Video,
  UploadCloud,
  Check,
  X,
  ExternalLink,
} from "lucide-react";
import HqLayout from "./HqLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const ACCEPTED_VIDEO_TYPES = ["video/mp4"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB

export default function HqAdvertisements() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: ads = [], isLoading } = useListHqAdvertisements({
    query: { queryKey: getListHqAdvertisementsQueryKey() },
  });

  const requestUpload = useRequestHqAdvertisementUpload();
  const createAd = useCreateHqAdvertisement();
  const updateAd = useUpdateHqAdvertisement();
  const deleteAd = useDeleteHqAdvertisement();

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingAd, setEditingAd] = useState<HqAdvertisement | null>(null);

  // Form state
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [alt, setAlt] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [sortOrder, setSortOrder] = useState(0);
  const [isActive, setIsActive] = useState(true);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListHqAdvertisementsQueryKey() });
  };

  const handleOpenCreate = () => {
    setEditingAd(null);
    setTitle("");
    setCaption("");
    setAlt("");
    setLinkUrl("");
    setSortOrder(0);
    setIsActive(true);
    setStartsAt("");
    setEndsAt("");
    setUploadFile(null);
    setIsEditorOpen(true);
  };

  const handleOpenEdit = (ad: HqAdvertisement) => {
    setEditingAd(ad);
    setTitle(ad.title);
    setCaption(ad.caption ?? "");
    setAlt(ad.alt ?? "");
    setLinkUrl(ad.linkUrl ?? "");
    setSortOrder(ad.sortOrder);
    setIsActive(ad.isActive);
    setStartsAt(ad.startsAt ? format(new Date(ad.startsAt), "yyyy-MM-dd'T'HH:mm") : "");
    setEndsAt(ad.endsAt ? format(new Date(ad.endsAt), "yyyy-MM-dd'T'HH:mm") : "");
    setUploadFile(null);
    setIsEditorOpen(true);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isImage = ACCEPTED_IMAGE_TYPES.includes(file.type);
    const isVideo = ACCEPTED_VIDEO_TYPES.includes(file.type);

    if (!isImage && !isVideo) {
      toast({
        title: "Unsupported file type",
        description: "Please upload a JPG, PNG, WebP, or MP4 file.",
        variant: "destructive",
      });
      return;
    }

    if (isImage && file.size > MAX_IMAGE_BYTES) {
      toast({
        title: "Image too large",
        description: "Image files must be under 10MB.",
        variant: "destructive",
      });
      return;
    }

    if (isVideo && file.size > MAX_VIDEO_BYTES) {
      toast({
        title: "Video too large",
        description: "Video files must be under 50MB.",
        variant: "destructive",
      });
      return;
    }

    setUploadFile(file);
    // Auto-fill title from filename if empty
    if (!title) {
      setTitle(file.name.replace(/\.[^/.]+$/, ""));
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "destructive" });
      return;
    }

    if (!editingAd && !uploadFile) {
      toast({ title: "Media file is required for new promotions", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      const payload = {
        title: title.trim(),
        alt: alt.trim() || null,
        caption: caption.trim() || null,
        linkUrl: linkUrl.trim() || null,
        sortOrder,
        isActive,
        startsAt: startsAt ? new Date(startsAt).toISOString() : null,
        endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      };

      if (editingAd) {
        await updateAd.mutateAsync({
          id: editingAd.id,
          data: payload,
        });
        toast({ title: "Promotion updated successfully." });
      } else {
        // Handle upload if there's a new file
        let objectPath = "";
        if (uploadFile) {
          const contentType = uploadFile.type as any;
          const uploadRes = await requestUpload.mutateAsync({
            data: { contentType, fileSize: uploadFile.size },
          });

          const s3Res = await fetch(uploadRes.uploadUrl, {
            method: "PUT",
            headers: { "Content-Type": contentType },
            body: uploadFile,
          });

          if (!s3Res.ok) {
            throw new Error("Failed to upload media to storage.");
          }
          objectPath = uploadRes.objectPath;
        }

        await createAd.mutateAsync({
          data: {
            ...payload,
            objectPath,
          },
        });
        toast({ title: "Promotion created successfully." });
      }

      refresh();
      setIsEditorOpen(false);
    } catch (error) {
      toast({
        title: "Failed to save promotion",
        description: error instanceof Error ? error.message : "An unknown error occurred.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (ad: HqAdvertisement) => {
    if (confirm(`Are you sure you want to delete "${ad.title}"?`)) {
      try {
        await deleteAd.mutateAsync({ id: ad.id });
        refresh();
        toast({ title: "Promotion deleted successfully." });
      } catch (error) {
        toast({
          title: "Failed to delete promotion",
          variant: "destructive",
        });
      }
    }
  };

  const handleToggleActive = async (ad: HqAdvertisement, newIsActive: boolean) => {
    try {
      await updateAd.mutateAsync({
        id: ad.id,
        data: { isActive: newIsActive },
      });
      refresh();
      toast({ title: `Promotion ${newIsActive ? 'activated' : 'deactivated'}` });
    } catch (error) {
      toast({
        title: "Failed to update status",
        variant: "destructive",
      });
    }
  };

  return (
    <HqLayout title="Promotions">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">
              Manage featured promotions displayed on the patient search screen.
            </p>
          </div>
          <Button onClick={handleOpenCreate} data-testid="button-create-ad">
            <Plus className="w-4 h-4 mr-2" />
            New Promotion
          </Button>
        </div>

        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Media</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead className="w-24 text-center">Order</TableHead>
                <TableHead className="w-24 text-center">Active</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                    Loading promotions...
                  </TableCell>
                </TableRow>
              ) : ads.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                    No promotions found. Create one to get started.
                  </TableCell>
                </TableRow>
              ) : (
                ads.map((ad) => (
                  <TableRow key={ad.id} data-testid={`row-ad-${ad.id}`}>
                    <TableCell>
                      <div className="h-16 w-16 rounded-md bg-muted flex items-center justify-center overflow-hidden border">
                        {ad.mediaKind === "image" ? (
                          <img
                            src={ad.mediaUrl}
                            alt={ad.alt || ad.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="relative w-full h-full bg-black text-white flex items-center justify-center">
                            <Video className="w-6 h-6 opacity-50" />
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-dark-green">{ad.title}</div>
                      {ad.caption && (
                        <div className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {ad.caption}
                        </div>
                      )}
                      {ad.linkUrl && (
                        <a
                          href={ad.linkUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center text-[10px] text-primary hover:underline mt-1"
                        >
                          {ad.linkUrl} <ExternalLink className="w-3 h-3 ml-1" />
                        </a>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="text-xs space-y-1">
                        {ad.startsAt ? (
                          <div>Start: {format(new Date(ad.startsAt), "MMM d, yyyy HH:mm")}</div>
                        ) : (
                          <div className="text-muted-foreground">No start time</div>
                        )}
                        {ad.endsAt ? (
                          <div>End: {format(new Date(ad.endsAt), "MMM d, yyyy HH:mm")}</div>
                        ) : (
                          <div className="text-muted-foreground">No end time</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-secondary text-secondary-foreground text-xs font-medium">
                        {ad.sortOrder}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={ad.isActive}
                        onCheckedChange={(checked) => handleToggleActive(ad, checked)}
                        data-testid={`switch-active-${ad.id}`}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(ad)}
                          data-testid={`button-edit-${ad.id}`}
                        >
                          <Pencil className="w-4 h-4 text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(ad)}
                          className="text-destructive hover:bg-destructive/10"
                          data-testid={`button-delete-${ad.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={isEditorOpen} onOpenChange={(open) => !isUploading && setIsEditorOpen(open)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingAd ? "Edit Promotion" : "New Promotion"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-4 py-4 max-h-[70vh] overflow-y-auto px-1">
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label>Media File {(!editingAd) && <span className="text-destructive">*</span>}</Label>
                
                {editingAd ? (
                  <div className="mb-2 relative rounded-lg border bg-muted overflow-hidden flex items-center justify-center">
                    {editingAd.mediaKind === "image" ? (
                      <img src={editingAd.mediaUrl} alt={editingAd.alt || ""} className="max-h-48 object-contain" />
                    ) : (
                      <video src={editingAd.mediaUrl} className="max-h-48 object-contain" controls muted />
                    )}
                  </div>
                ) : (
                  <>
                    {uploadFile && (
                      <div className="mb-2 relative rounded-lg border bg-muted p-2 flex items-center justify-between">
                        <div className="flex items-center gap-2 overflow-hidden">
                          {uploadFile.type.startsWith("image/") ? <ImageIcon className="w-4 h-4 shrink-0" /> : <Video className="w-4 h-4 shrink-0" />}
                          <span className="text-sm truncate">{uploadFile.name}</span>
                        </div>
                        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => setUploadFile(null)}>
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                    
                    <Input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,video/mp4"
                      className="hidden"
                      ref={fileInputRef}
                      onChange={handleFileChange}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <UploadCloud className="w-4 h-4 mr-2" />
                      {uploadFile ? "Replace File" : "Choose File"}
                    </Button>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      Images up to 10MB (JPG, PNG, WebP). Videos up to 50MB (MP4).
                    </p>
                  </>
                )}
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label>Internal Title <span className="text-destructive">*</span></Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Summer Malaria Campaign"
                />
              </div>

              <div className="space-y-2 sm:col-span-2">
                <Label>Caption (Optional)</Label>
                <Textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="Visible text overlay or description"
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label>Link URL (Optional)</Label>
                <Input
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://..."
                />
              </div>

              <div className="space-y-2">
                <Label>Alt Text (Optional)</Label>
                <Input
                  value={alt}
                  onChange={(e) => setAlt(e.target.value)}
                  placeholder="For screen readers"
                />
              </div>
              
              <div className="space-y-2">
                <Label>Start Time (Optional)</Label>
                <Input
                  type="datetime-local"
                  value={startsAt}
                  onChange={(e) => setStartsAt(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>End Time (Optional)</Label>
                <Input
                  type="datetime-local"
                  value={endsAt}
                  onChange={(e) => setEndsAt(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  min="0"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(Number(e.target.value))}
                />
                <p className="text-[10px] text-muted-foreground">Lower numbers appear first</p>
              </div>

              <div className="space-y-2 flex flex-col justify-center">
                <Label className="mb-2">Status</Label>
                <div className="flex items-center space-x-2">
                  <Switch
                    checked={isActive}
                    onCheckedChange={setIsActive}
                  />
                  <span className="text-sm font-medium">
                    {isActive ? "Active" : "Inactive"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsEditorOpen(false)}
              disabled={isUploading}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleSave()}
              disabled={isUploading}
              data-testid="button-save-ad"
            >
              {isUploading ? (
                "Saving..."
              ) : (
                <>
                  <Check className="w-4 h-4 mr-2" /> Save Promotion
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </HqLayout>
  );
}
