import { createContext, useContext, type ReactNode } from "react";

export type ToastTone = "info" | "error" | "gold";

export const ToastContext = createContext<(text: ReactNode, tone?: ToastTone) => void>(() => {});

/** Shows a short notification; rendered by <ToastProvider>. */
export function useToast() {
  return useContext(ToastContext);
}
