import { Alert, Platform } from "react-native";

/**
 * Messages and yes/no questions. React Native's Alert does nothing in a web
 * build, which is how the app is tested in a browser, so the browser's own
 * dialogs stand in there.
 */
export function notify(title: string, message?: string) {
  if (Platform.OS === "web") {
    globalThis.alert?.(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

export function confirmAction(
  title: string,
  message: string,
  options: { confirmText: string; cancelText?: string; destructive?: boolean },
): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? false);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: options.cancelText ?? "Cancel", style: "cancel", onPress: () => resolve(false) },
        {
          text: options.confirmText,
          style: options.destructive ? "destructive" : "default",
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
