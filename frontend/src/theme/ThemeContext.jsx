import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const STORAGE_KEY = "rakaez_visual_theme";
const ThemeContext = createContext(null);

function getSystemTheme() {
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

function getInitialTheme() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (saved === "light" || saved === "dark" || saved === "system") {
      return saved;
    }
  } catch {
    // Ignore storage errors and use system mode.
  }

  return "system";
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme);
  const [systemTheme, setSystemTheme] = useState(getSystemTheme);

  const resolvedTheme = theme === "system" ? systemTheme : theme;

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const handleSystemChange = (event) => {
      setSystemTheme(event.matches ? "dark" : "light");
    };

    setSystemTheme(media.matches ? "dark" : "light");

    if (media.addEventListener) {
      media.addEventListener("change", handleSystemChange);
    } else {
      media.addListener(handleSystemChange);
    }

    return () => {
      if (media.removeEventListener) {
        media.removeEventListener("change", handleSystemChange);
      } else {
        media.removeListener(handleSystemChange);
      }
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolvedTheme);
    document.documentElement.setAttribute("data-theme-mode", theme);

    document.documentElement.style.colorScheme = resolvedTheme;

    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Theme still works if localStorage is unavailable.
    }
  }, [theme, resolvedTheme]);

  function setThemeMode(mode) {
    if (!["light", "dark", "system"].includes(mode)) return;
    setTheme(mode);
  }

  function cycleTheme() {
    setTheme((current) => {
      if (current === "light") return "dark";
      if (current === "dark") return "system";
      return "light";
    });
  }

  const value = useMemo(
    () => ({
      theme,
      resolvedTheme,
      systemTheme,
      setTheme: setThemeMode,
      setThemeMode,
      cycleTheme,
      toggleTheme: cycleTheme,
    }),
    [theme, resolvedTheme, systemTheme]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);

  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }

  return ctx;
}
