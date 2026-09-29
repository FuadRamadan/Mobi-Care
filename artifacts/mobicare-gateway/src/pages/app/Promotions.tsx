import { useRef, useState } from "react";
import { ExternalLink } from "lucide-react";
import {
  type AdvertisementMediaItem,
  type PublicAdvertisement,
  useListAdvertisements,
  getListAdvertisementsQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Promotions on the patient home screen, one card under another: the
 * picture, who it is from, a short subject, and "Read more" for the full
 * article. A promotion that came with several pictures is swiped through
 * sideways inside its own card.
 */
export function Promotions() {
  const { data: ads = [] } = useListAdvertisements({
    query: { queryKey: getListAdvertisementsQueryKey() },
  });
  const [open, setOpen] = useState<PublicAdvertisement | null>(null);

  if (ads.length === 0) return null;

  return (
    <section className="w-full max-w-2xl mx-auto space-y-3" aria-labelledby="promotions-heading">
      <h2
        id="promotions-heading"
        className="text-sm font-semibold text-muted-foreground uppercase tracking-wider"
      >
        Promotions
      </h2>
      <div className="space-y-4">
        {ads.map((ad) => (
          <article
            key={ad.id}
            className="rounded-2xl border bg-card overflow-hidden shadow-sm"
            data-testid={`promotion-${ad.id}`}
          >
            <Gallery media={ad.media} title={ad.title} fit="cover" />
            <div className="p-4 space-y-2">
              {ad.organisation && (
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {ad.organisation}
                </p>
              )}
              <h3 className="font-semibold text-dark-green leading-snug line-clamp-2">{ad.title}</h3>
              <Button
                variant="link"
                className="h-auto p-0 text-primary"
                onClick={() => setOpen(ad)}
                data-testid={`button-read-more-${ad.id}`}
              >
                Read more
              </Button>
            </div>
          </article>
        ))}
      </div>

      <Dialog open={!!open} onOpenChange={(value) => !value && setOpen(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0 gap-0">
          {open && (
            <>
              <Gallery media={open.media} title={open.title} fit="contain" />
              <div className="p-5 space-y-3">
                <DialogHeader className="text-left space-y-1">
                  {open.organisation && (
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      {open.organisation}
                    </p>
                  )}
                  <DialogTitle className="font-display text-xl text-dark-green leading-snug">
                    {open.title}
                  </DialogTitle>
                  {open.caption && (
                    <DialogDescription className="text-sm text-foreground/80">
                      {open.caption}
                    </DialogDescription>
                  )}
                </DialogHeader>
                {open.body && (
                  <div className="text-sm leading-relaxed whitespace-pre-line text-foreground">
                    {open.body}
                  </div>
                )}
                {open.linkUrl && (
                  <Button asChild variant="outline" className="rounded-full">
                    <a href={open.linkUrl} target="_blank" rel="noreferrer">
                      Visit link <ExternalLink className="w-4 h-4" />
                    </a>
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** One picture, or several swiped sideways with dots showing which is in view. */
function Gallery({
  media,
  title,
  fit,
}: {
  media: AdvertisementMediaItem[];
  title: string;
  fit: "cover" | "contain";
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(0);
  const multiple = media.length > 1;

  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    setCurrent(Math.round(element.scrollLeft / element.clientWidth));
  };

  const goTo = (index: number) => {
    const element = scroller.current;
    element?.scrollTo({ left: index * element.clientWidth, behavior: "smooth" });
  };

  return (
    <div className="relative bg-muted">
      <div
        ref={scroller}
        onScroll={multiple ? onScroll : undefined}
        className={`flex aspect-[16/9] ${
          multiple ? "overflow-x-auto snap-x snap-mandatory scrollbar-none" : "overflow-hidden"
        }`}
        aria-label={multiple ? `${title}: ${media.length} pictures, swipe to see more` : undefined}
      >
        {media.map((item, index) => (
          <div key={item.id} className="w-full h-full shrink-0 snap-center">
            {item.mediaKind === "video" ? (
              <video
                src={item.url}
                controls
                muted
                playsInline
                preload="metadata"
                className="w-full h-full object-contain bg-black"
                title={item.alt || title}
              />
            ) : (
              <img
                src={item.url}
                alt={item.alt || (multiple ? `${title} (${index + 1} of ${media.length})` : title)}
                loading="lazy"
                className={`w-full h-full bg-white ${fit === "cover" ? "object-cover" : "object-contain"}`}
              />
            )}
          </div>
        ))}
      </div>
      {multiple && (
        <div className="absolute bottom-2 inset-x-0 flex justify-center gap-1.5">
          {media.map((item, index) => (
            <button
              key={item.id}
              type="button"
              className={`w-2 h-2 rounded-full shadow ${index === current ? "bg-white" : "bg-white/50"}`}
              onClick={() => goTo(index)}
              aria-label={`Show picture ${index + 1} of ${media.length}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
