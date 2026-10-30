import React, { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";
import { mapHtml } from "@/lib/mapHtml";

export interface MapFrameHandle {
  send: (message: object) => void;
}

/**
 * The map page in a WebView. The page loads as if from MobiCare's own site, so
 * OpenStreetMap's tile servers see the referrer their usage policy asks for.
 */
export const MapFrame = forwardRef<MapFrameHandle, { height: number; onMessage: (message: any) => void; testID?: string }>(
  function MapFrame({ height, onMessage, testID }, ref) {
    const web = useRef<WebView>(null);
    const html = useMemo(mapHtml, []);
    useImperativeHandle(ref, () => ({
      send: (message) => web.current?.injectJavaScript(`window.__mcMap(${JSON.stringify(message)}); true;`),
    }));
    return (
      <View style={{ height, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "#D9E2DE" }} testID={testID}>
        <WebView
          ref={web}
          source={{ html, baseUrl: `https://${process.env.EXPO_PUBLIC_DOMAIN}/` }}
          originWhitelist={["*"]}
          onMessage={(event) => {
            try {
              onMessage(JSON.parse(event.nativeEvent.data));
            } catch {
              // not ours
            }
          }}
          javaScriptEnabled
          // Panning the map must not scroll the page around it.
          nestedScrollEnabled
          setBuiltInZoomControls={false}
        />
      </View>
    );
  },
);
