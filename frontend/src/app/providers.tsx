"use client";

import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { useState, useMemo } from "react";
import { LocaleContext } from "@/lib/useLocale";
import { translations, type Locale } from "@/lib/i18n";

export function Providers({ children }: { children: React.ReactNode }) {
  const [locale, setLocale] = useState<Locale>("en");
  const t = useMemo(() => translations[locale], [locale]);

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <SessionProvider>
        <LocaleContext.Provider value={{ locale, t, setLocale }}>
          {children}
        </LocaleContext.Provider>
      </SessionProvider>
    </ThemeProvider>
  );
}
