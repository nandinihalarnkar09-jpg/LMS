import { useQuery } from "@tanstack/react-query";

/** Public switches from GET /api/config (no secrets). */
export type AppConfig = { uploadsEnabled: boolean; publicDemo: boolean };

const FALLBACK: AppConfig = { uploadsEnabled: false, publicDemo: false };

export function useAppConfig(): AppConfig {
  const { data } = useQuery({
    queryKey: ["app-config"],
    queryFn: async () => {
      const res = await fetch("/api/config");
      if (!res.ok) return FALLBACK;
      return (await res.json()) as AppConfig;
    },
    staleTime: Infinity,
    retry: 1,
  });
  return data ?? FALLBACK;
}
