"use client";

import { createContext, useContext } from "react";
import type { Locale, T } from "./i18n";
import { translations } from "./i18n";

interface LocaleCtx {
  locale: Locale;
  t: T;
  setLocale: (l: Locale) => void;
}

export const LocaleContext = createContext<LocaleCtx>({
  locale: "en",
  t: translations.en,
  setLocale: () => {},
});

export function useLocale() {
  return useContext(LocaleContext);
}
