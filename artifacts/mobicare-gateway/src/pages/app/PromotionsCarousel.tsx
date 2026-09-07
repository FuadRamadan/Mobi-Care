import { useEffect, useRef, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import {
  type PublicAdvertisement,
  useListAdvertisements,
  getListAdvertisementsQueryKey,
} from "@workspace/api-client-react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
} from "@/components/ui/carousel";

export function PromotionsCarousel() {
  const { data: ads = [] } = useListAdvertisements({
    query: { queryKey: getListAdvertisementsQueryKey() },
  });

  const [api, setApi] = useState<any>();
  const [current, setCurrent] = useState(0);
  
  useEffect(() => {
    if (!api) return;

    setCurrent(api.selectedScrollSnap());

    api.on("select", () => {
      setCurrent(api.selectedScrollSnap());
    });
  }, [api]);

  // Auto-advance
  useEffect(() => {
    if (!api || ads.length <= 1) return;
    
    const interval = setInterval(() => {
      if (api.canScrollNext()) {
        api.scrollNext();
      } else {
        api.scrollTo(0);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [api, ads.length]);

  if (!ads || ads.length === 0) return null;

  return (
    <div className="w-full max-w-2xl mx-auto space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          Featured Promotions
        </h2>
        {ads.length > 1 && (
          <div className="flex gap-1.5">
            {ads.map((_, i) => (
              <button
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === current ? "bg-primary" : "bg-primary/20"
                }`}
                onClick={() => api?.scrollTo(i)}
                aria-label={`Go to slide ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      <Carousel setApi={setApi} className="w-full" opts={{ loop: true }}>
        <CarouselContent>
          {ads.map((ad, index) => (
            <CarouselItem key={ad.id}>
              <div className="relative rounded-2xl overflow-hidden bg-card border shadow-sm aspect-[16/9] sm:aspect-[21/9]">
                {ad.linkUrl ? (
                  <a href={ad.linkUrl} target="_blank" rel="noreferrer" className="block w-full h-full">
                    <MediaContent ad={ad} isActive={index === current} />
                  </a>
                ) : (
                  <MediaContent ad={ad} isActive={index === current} />
                )}
                {ad.caption && (
                  <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-4 pt-12 text-white pointer-events-none">
                    <p className="text-sm sm:text-base font-medium drop-shadow-md">
                      {ad.caption}
                    </p>
                  </div>
                )}
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>
    </div>
  );
}

function MediaContent({
  ad,
  isActive,
}: {
  ad: PublicAdvertisement;
  isActive: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (isActive) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
      video.currentTime = 0;
    }
  }, [isActive]);

  if (ad.mediaKind === "video") {
    return (
      <video
        ref={videoRef}
        src={ad.mediaUrl}
        loop
        muted
        playsInline
        preload={isActive ? "auto" : "metadata"}
        className="w-full h-full object-cover"
        title={ad.alt || ad.title}
      />
    );
  }
  
  return (
    <img
      src={ad.mediaUrl}
      alt={ad.alt || ad.title}
      className="w-full h-full object-contain bg-white"
    />
  );
}
