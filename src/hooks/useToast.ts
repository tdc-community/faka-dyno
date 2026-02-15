import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastState } from "../types";

export function useToast(timeoutMs = 2200) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<number | null>(null);

  const showToast = useCallback(
    (message: string, tone: ToastState["tone"] = "info") => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }

      setToast({ message, tone });
      timerRef.current = window.setTimeout(() => {
        setToast(null);
      }, timeoutMs);
    },
    [timeoutMs],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { toast, showToast };
}