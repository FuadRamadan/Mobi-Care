import { useRef, useState } from 'react';
import {
  useListCouriers,
  useCreateCourier,
  useUpdateCourier,
  useDeleteCourier,
  useRequestCourierPhotoUpload,
  useAttachCourierPhoto,
  useRemoveCourierPhoto,
  getListCouriersQueryKey,
  getListHqOrdersQueryKey,
  getListDispatchOrdersQueryKey,
  type Courier,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import HqLayout from './HqLayout';
import { EmptyState, formatDate } from './shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { Pencil, Trash2, Upload, X } from 'lucide-react';

const emptyForm = { name: '', phone: '', vehicleType: 'motorbike' };

export default function HqCouriers() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useListCouriers();
  const couriers = data ?? [];

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListCouriersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListHqOrdersQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListDispatchOrdersQueryKey() });
  };
  const onError = (err: unknown) =>
    toast({ title: 'Action failed', description: err instanceof Error ? err.message : 'Please try again', variant: 'destructive' });

  const create = useCreateCourier({
    mutation: {
      onSuccess: (created) => {
        queryClient.setQueryData<Courier[]>(getListCouriersQueryKey(), (current) =>
          current ? [created, ...current] : [created],
        );
        refresh();
        setOpen(false);
        setForm(emptyForm);
      },
      onError,
    },
  });
  const update = useUpdateCourier({
    mutation: {
      onSuccess: (updated) => {
        queryClient.setQueryData<Courier[]>(getListCouriersQueryKey(), (current) =>
          current?.map((courier) =>
            courier.id === updated.id ? { ...courier, ...updated } : courier,
          ),
        );
        refresh();
        setEditOpen(false);
        setEditingCourier(null);
        setForm(emptyForm);
      },
      onError,
    },
  });
  const remove = useDeleteCourier({
    mutation: {
      onSuccess: () => {
        const deletedId = deleteTarget?.id;
        if (deletedId) {
          queryClient.setQueryData<Courier[]>(getListCouriersQueryKey(), (current) =>
            current?.filter((courier) => courier.id !== deletedId),
          );
        }
        refresh();
        setDeleteTarget(null);
        toast({ title: 'Courier deleted', description: 'The courier was removed from the fleet.' });
      },
      onError,
    },
  });
  const photoUpload = useRequestCourierPhotoUpload({ mutation: { onError } });
  const photoAttach = useAttachCourierPhoto({ mutation: { onError, onSuccess: () => refresh() } });
  const photoRemove = useRemoveCourierPhoto({ mutation: { onError, onSuccess: () => refresh() } });
  const photoInput = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingCourier, setEditingCourier] = useState<Courier | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Courier | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [photoCourier, setPhotoCourier] = useState<Courier | null>(null);

  const uploadPhoto = async (file: File) => {
    if (!photoCourier) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      toast({ title: 'Invalid photo', description: 'Choose a JPG, PNG, or WebP image no larger than 5 MB.', variant: 'destructive' });
      return;
    }
    try {
      const target = await photoUpload.mutateAsync({ id: photoCourier.id, data: { contentType: file.type as 'image/jpeg' | 'image/png' | 'image/webp', fileSize: file.size } });
      const response = await fetch(target.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!response.ok) throw new Error('Photo upload failed. Please try again.');
      await photoAttach.mutateAsync({ id: photoCourier.id, data: { objectPath: target.objectPath } });
      toast({ title: 'Courier photo updated' });
    } catch (error) {
      onError(error);
    } finally {
      if (photoInput.current) photoInput.current.value = '';
    }
  };

  return (
    <HqLayout title="Courier Fleet">
      <div className="mb-4">
        <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
          onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadPhoto(file); }} />
        <Dialog
          open={open || editOpen}
          onOpenChange={(value) => {
            if (value) {
              if (!editingCourier) setOpen(true);
              return;
            }
            setOpen(false);
            setEditOpen(false);
            setEditingCourier(null);
            setForm(emptyForm);
          }}
        >
          <DialogTrigger asChild>
            <Button data-testid="button-add-courier">Add courier</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingCourier ? 'Edit courier' : 'Add courier'}</DialogTitle>
              <DialogDescription>
                {editingCourier ? 'Update the courier details used across dispatch and delivery records.' : 'Add a courier to the MobiCare delivery fleet.'}
              </DialogDescription>
            </DialogHeader>
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                const data = {
                  name: form.name,
                  phone: form.phone,
                  vehicleType: form.vehicleType as 'motorbike' | 'bicycle' | 'car' | 'van',
                };
                if (editingCourier) {
                  update.mutate({ id: editingCourier.id, data });
                } else {
                  create.mutate({ data });
                }
              }}
            >
              <div className="space-y-1.5">
                <Label>Full name</Label>
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="input-courier-name" />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input required minLength={5} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} data-testid="input-courier-phone" />
              </div>
              <div className="space-y-1.5">
                <Label>Vehicle</Label>
                <Select value={form.vehicleType} onValueChange={(v) => setForm({ ...form, vehicleType: v })}>
                  <SelectTrigger data-testid="select-vehicle"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['motorbike', 'bicycle', 'car', 'van'].map((v) => (
                      <SelectItem key={v} value={v} className="capitalize">{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={create.isPending || update.isPending} className="w-full" data-testid="button-submit-courier">
                {create.isPending || update.isPending ? 'Saving…' : editingCourier ? 'Save changes' : 'Add courier'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(value) => !value && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete courier?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <strong>{deleteTarget?.name}</strong> from the courier fleet. This action cannot be undone.
              Couriers with active deliveries must be reassigned before they can be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                if (deleteTarget) remove.mutate({ id: deleteTarget.id });
              }}
            >
              {remove.isPending ? 'Deleting…' : 'Delete Courier'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : couriers.length === 0 ? (
        <EmptyState>No couriers in the fleet yet.</EmptyState>
      ) : (
        <div className="border rounded-xl bg-card overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Courier</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Active deliveries</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Added</TableHead>
                 <TableHead className="w-40">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {couriers.map((c) => (
                <TableRow key={c.id} data-testid={`row-courier-${c.id}`}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {c.photoUrl ? <img src={c.photoUrl} alt="" className="h-9 w-9 rounded-full object-cover" /> : <div className="h-9 w-9 rounded-full bg-muted" />}
                      {c.name}
                    </div>
                  </TableCell>
                  <TableCell>{c.phone}</TableCell>
                  <TableCell className="capitalize">{c.vehicleType}</TableCell>
                  <TableCell>{c.activeDeliveries ?? 0}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={c.isActive}
                        disabled={update.isPending}
                        onCheckedChange={(v) => update.mutate({ id: c.id, data: { isActive: v } })}
                        data-testid={`switch-courier-${c.id}`}
                      />
                      <Badge variant="secondary" className={c.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}>
                        {c.isActive ? 'active' : 'inactive'}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatDate(c.createdAt)}</TableCell>
                   <TableCell>
                     <div className="flex items-center gap-2">
                       <Button
                         variant="outline"
                         size="sm"
                         className="gap-1.5"
                         onClick={() => {
                           setEditingCourier(c);
                           setForm({ name: c.name, phone: c.phone, vehicleType: c.vehicleType });
                           setEditOpen(true);
                         }}
                         data-testid={`button-edit-courier-${c.id}`}
                       >
                         <Pencil className="w-3.5 h-3.5" />
                         Edit
                       </Button>
                        <Button variant="outline" size="sm" className="gap-1.5"
                          disabled={photoUpload.isPending || photoAttach.isPending}
                          onClick={() => { setPhotoCourier(c); setTimeout(() => photoInput.current?.click(), 0); }}
                          data-testid={`button-upload-courier-photo-${c.id}`}>
                          <Upload className="w-3.5 h-3.5" /> {c.photoUrl ? 'Replace photo' : 'Upload photo'}
                        </Button>
                        {c.photoUrl && (
                          <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive"
                            disabled={photoRemove.isPending}
                            onClick={() => photoRemove.mutate({ id: c.id })}
                            data-testid={`button-remove-courier-photo-${c.id}`}>
                            <X className="w-3.5 h-3.5" /> Remove photo
                          </Button>
                        )}
                       <Button
                         variant="outline"
                         size="sm"
                         className="gap-1.5 text-destructive hover:text-destructive"
                         onClick={() => setDeleteTarget(c)}
                         data-testid={`button-delete-courier-${c.id}`}
                       >
                         <Trash2 className="w-3.5 h-3.5" />
                         Delete
                       </Button>
                     </div>
                   </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </HqLayout>
  );
}
