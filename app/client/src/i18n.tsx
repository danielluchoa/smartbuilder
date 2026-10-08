import { createContext, useContext, type ReactNode } from "react";

export type Lang = "en" | "pt" | "es";

/**
 * Interface language ONLY. Money (USD), measurements (feet/miles),
 * and dates (MM/DD/YYYY) are locale formatting and ALWAYS stay in the
 * US format regardless of the selected language — they never pass
 * through this module.
 */
let currentLang: Lang = "en";
export function getCurrentLang(): Lang {
  return currentLang;
}
export function setCurrentLang(lang: Lang): void {
  currentLang = lang;
}

/**
 * Translate a UI string. English is the source string; the second
 * argument is Brazilian Portuguese, the third is neutral Latin-American
 * Spanish. Spanish falls back to English only while a translation is
 * missing — shipped code always passes all three. Proper names, company
 * names, and user-entered content are never passed through here.
 */
export function tr(en: string, pt: string, es?: string): string {
  if (currentLang === "pt") return pt;
  if (currentLang === "es") return es ?? en;
  return en;
}

type LanguageCtxValue = {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (en: string, pt: string, es?: string) => string;
};

export const LanguageContext = createContext<LanguageCtxValue>({
  lang: "en",
  setLang: () => undefined,
  t: (en: string) => en,
});

export function useLanguage(): LanguageCtxValue {
  return useContext(LanguageContext);
}

/** Shorthand hook: const t = useT(); t("Save", "Salvar", "Guardar") */
export function useT(): (en: string, pt: string, es?: string) => string {
  return useContext(LanguageContext).t;
}

export function langDocValue(lang: Lang): string {
  if (lang === "pt") return "pt-BR";
  if (lang === "es") return "es";
  return "en";
}

export function LanguageToggle({ compact = false, variant = "dark" }: { compact?: boolean; variant?: "dark" | "light" }) {
  const { lang, setLang } = useLanguage();
  const btn = (value: Lang, label: string, ariaEn: string, ariaPt: string, ariaEs: string) => (
    <button
      key={value}
      type="button"
      aria-label={tr(ariaEn, ariaPt, ariaEs)}
      aria-pressed={lang === value}
      onClick={() => setLang(value)}
      className={`${compact ? "px-2 py-1 text-[11px]" : "px-3 py-2 text-sm"} font-black ${lang === value ? (variant === "dark" ? "bg-white text-[#0f2a44]" : "bg-[#0f2a44] text-white") : variant === "dark" ? "text-white/70" : "text-[#5b6b7a]"}`}
    >
      {label}
    </button>
  );
  return (
    <div
      className={`flex shrink-0 items-center overflow-hidden rounded-lg ring-1 ${variant === "dark" ? "bg-white/10 ring-white/15" : "bg-[#f6f8fa] ring-[#dde3ea]"}`}
      role="group"
      aria-label={tr("Interface language", "Idioma da interface", "Idioma de la interfaz")}
    >
      {btn("en", "EN", "Switch interface language to English", "Mudar o idioma da interface para inglês", "Cambiar el idioma de la interfaz a inglés")}
      {btn("pt", "PT", "Switch interface language to Portuguese", "Mudar o idioma da interface para português", "Cambiar el idioma de la interfaz a portugués")}
      {btn("es", "ES", "Switch interface language to Spanish", "Mudar o idioma da interface para espanhol", "Cambiar el idioma de la interfaz a español")}
    </div>
  );
}

export function LanguageProviderShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
