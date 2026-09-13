import { useCallback, useEffect, useRef, useState } from "react";
import api from "../services/api";
import { createLatestRequest } from "../utils/requests";

export default function useTables() {
  const [tables, setTables] = useState([]);
  const [error, setError] = useState("");
  const requests = useRef(createLatestRequest());
  const refresh = useCallback(async () => {
    const controller = requests.current.start();
    try {
      const { data } = await api.get("/tables", { signal: controller.signal });
      if (controller.signal.aborted) return;
      setTables(data);
      setError("");
    } catch (err) {
      if (!controller.signal.aborted) setError(err.message);
    }
  }, []);
  useEffect(() => {
    const current = requests.current;
    refresh();
    return () => current.cancel();
  }, [refresh]);
  return { tables, error, refresh };
}
