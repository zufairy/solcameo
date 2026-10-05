"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "vello-theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  setTheme: () => {},
  toggleTheme: () => {},
});

/** Apply the theme class to <html>. `.dark` and `.light` are mutually exclusive;
 *  `.dark` drives Tailwind's dark variant + the dark token block, `.light` the
 *  light token overrides in globals.css. `color-scheme` fixes native form controls
 *  and scrollbars. */
function applyTheme(t: Theme) {
  const el = document.documentElement;
  el.classList.toggle("dark", t === "dark");
  el.classList.toggle("light", t === "light");
  el.style.colorScheme = t;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // SSR renders dark (matches the layout's default <html class="dark">); the inline
  // no-flash script + this effect reconcile to the stored preference before paint.
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    let stored: Theme | null = null;
    try { stored = localStorage.getItem(STORAGE_KEY) as Theme | null; } catch { /* private mode */ }
    const initial: Theme = stored === "light" || stored === "dark" ? stored : "dark";
    setThemeState(initial);
    applyTheme(initial);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch { /* ignore */ }
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** Inline script string for the <head> — sets the theme class BEFORE first paint so
 *  there's no dark→light flash on a light-preference reload. Defaults to dark. */
export const THEME_NO_FLASH_SCRIPT = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');var l=t==='light';var e=document.documentElement;e.classList.toggle('light',l);e.classList.toggle('dark',!l);e.style.colorScheme=l?'light':'dark';}catch(e){}})();`;
