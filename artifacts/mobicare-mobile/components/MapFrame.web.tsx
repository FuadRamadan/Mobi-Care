import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { View } from "react-native";
import { mapHtml } from "@/lib/mapHtml";
import type { MapFrameHandle } from "./MapFrame";

export type { MapFrameHandle };

/** The same map page as on phones, in an iframe, for the web test build. */
export const MapFrame = forwardRef<MapFrameHandle, { height: number; onMessage: (message: any) => void; testID?: string }>(
  function MapFrame({ height, onMessage, testID }, ref) {
    const frame = useRef<HTMLIFrameElement | null>(null);
    const html = useMemo(mapHtml, []);
    const handler = useRef(onMessage);
    handler.current = onMessage;
    useImperativeHandle(ref, () => ({
      send: (message) => frame.current?.contentWindow?.postMessage(message, "*"),
    }));
    useEffect(() => {
      const listen = (event: MessageEvent) => {
        if (event.source === frame.current?.contentWindow && event.data?.source === "mc-map") handler.current(event.data);
      };
      window.addEventListener("message", listen);
      return () => window.removeEventListener("message", listen);
    }, []);
    return (
      <View style={{ height, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "#D9E2DE" }} testID={testID}>
        <iframe ref={frame} srcDoc={html} title="Map" style={{ border: 0, width: "100%", height: "100%" }} />
      </View>
    );
  },
);
