import { useEffect, useState } from "react";
import api, { onUnauthorized } from "../services/api";
import { clearToken } from "../services/session";

export default function useSession() {
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    const unsubscribe = onUnauthorized(() => setSession(null));
    api
      .get("/auth/me", { signal: controller.signal })
      .then(({ data }) => {
        if (!controller.signal.aborted) setSession(data);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSession(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setChecking(false);
      });
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, []);

  function logout() {
    clearToken();
    setSession(null);
    // Logout is local and immediate; the server holds no session state.
    api.post("/auth/logout").catch(() => {});
  }
  return { session, checking, signIn: setSession, logout };
}
