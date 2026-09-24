import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { formatApiError, isAbortError } from "../api/errors";
import type { Server } from "../api/types";

export function useServers() {
  const [servers, setServers] = useState<Server[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");
    api
      .listServers({ signal: controller.signal })
      .then((res) => {
        setServers(res.servers);
        setStatus("ready");
        setError(null);
      })
      .catch((err: unknown) => {
        if (isAbortError(err)) return;
        setStatus("error");
        setError(formatApiError(err) || "Could not load servers.");
      });
    return () => controller.abort();
  }, [reloadToken]);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  const create = useCallback(async (body: { name: string; url: string }) => {
    const res = await api.createServer(body);
    setServers((current) => [...current, res.server]);
  }, []);

  const remove = useCallback(async (id: string) => {
    await api.deleteServer(id);
    setServers((current) => current.filter((server) => server.id !== id));
  }, []);

  return { servers, status, error, reload, create, remove };
}
