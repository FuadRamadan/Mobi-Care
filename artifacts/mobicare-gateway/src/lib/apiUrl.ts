const configuredApiUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, "");

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return configuredApiUrl
    ? `${configuredApiUrl}${normalizedPath}`
    : `${import.meta.env.BASE_URL.replace(/\/$/, "")}${normalizedPath}`;
}