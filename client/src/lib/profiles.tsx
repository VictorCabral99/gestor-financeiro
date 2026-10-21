import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getStoredProfileId, setStoredProfileId } from "../lib/api";

export type Profile = {
  id: string;
  name: string;
  dbFile: string;
  createdAt: string;
};

type ProfilesContextValue = {
  profiles: Profile[];
  activeId: string | null;
  active: Profile | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  switchTo: (id: string) => void;
  create: (name: string) => Promise<Profile>;
  rename: (id: string, name: string) => Promise<Profile>;
  remove: (id: string) => Promise<void>;
};

const ProfilesContext = createContext<ProfilesContextValue | null>(null);

export function ProfilesProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(getStoredProfileId());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const list = await api.get<Profile[]>("/profiles");
      setProfiles(list);
      const stored = getStoredProfileId();
      const next =
        (stored && list.find((p) => p.id === stored)?.id) || list[0]?.id || null;
      if (next && next !== stored) setStoredProfileId(next);
      setActiveId(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar perfis");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const switchTo = useCallback((id: string) => {
    if (id === getStoredProfileId()) return;
    setStoredProfileId(id);
    window.location.reload();
  }, []);

  const create = useCallback(async (name: string) => {
    const profile = await api.post<Profile>("/profiles", { name });
    setStoredProfileId(profile.id);
    window.location.reload();
    return profile;
  }, []);

  const rename = useCallback(async (id: string, name: string) => {
    const profile = await api.patch<Profile>(`/profiles/${id}`, { name });
    setProfiles((prev) => prev.map((p) => (p.id === id ? profile : p)));
    return profile;
  }, []);

  const remove = useCallback(
    async (id: string) => {
      await api.delete(`/profiles/${id}`);
      const remaining = profiles.filter((p) => p.id !== id);
      const next = remaining[0]?.id;
      if (next) setStoredProfileId(next);
      else setStoredProfileId("");
      window.location.reload();
    },
    [profiles],
  );

  const active = useMemo(
    () => profiles.find((p) => p.id === activeId) ?? null,
    [profiles, activeId],
  );

  const value = useMemo(
    () => ({
      profiles,
      activeId,
      active,
      loading,
      error,
      refresh,
      switchTo,
      create,
      rename,
      remove,
    }),
    [profiles, activeId, active, loading, error, refresh, switchTo, create, rename, remove],
  );

  return <ProfilesContext.Provider value={value}>{children}</ProfilesContext.Provider>;
}

export function useProfiles() {
  const ctx = useContext(ProfilesContext);
  if (!ctx) throw new Error("useProfiles fora do ProfilesProvider");
  return ctx;
}
