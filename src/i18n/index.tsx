import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Language, TooltipItem } from './types';
import { ko } from './ko';
import { en } from './en';

export * from './types';
export { ko } from './ko';
export { en } from './en';

const STORAGE_KEY = 'hdm_language';

export function detectDefaultLanguage(): Language {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ko' || saved === 'en') {
      return saved;
    }
    const navLang = navigator.language || '';
    if (navLang.toLowerCase().startsWith('ko')) {
      return 'ko';
    }
  }
  return 'ko'; // Primary language per specification
}

export function translate(
  key: string,
  params?: Record<string, string | number>,
  lang: Language = detectDefaultLanguage()
): string {
  const dict = lang === 'ko' ? ko : en;
  const fallbackDict = en;

  let val = (dict as Record<string, unknown>)[key];
  if (val === undefined || typeof val !== 'string') {
    val = (fallbackDict as Record<string, unknown>)[key];
  }

  if (val === undefined || typeof val !== 'string') {
    return key;
  }

  if (params) {
    let result = val;
    for (const [k, v] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return result;
  }

  return val;
}

export function getTooltip(
  key: string,
  lang: Language = detectDefaultLanguage()
): TooltipItem | undefined {
  const dict = lang === 'ko' ? ko : en;
  const fallbackDict = en;

  let val = (dict as Record<string, unknown>)[key];
  if (!val || typeof val !== 'object') {
    val = (fallbackDict as Record<string, unknown>)[key];
  }

  if (val && typeof val === 'object' && 'title' in val && 'body' in val) {
    return val as TooltipItem;
  }

  return undefined;
}

interface I18nContextValue {
  lang: Language;
  setLang: (lang: Language) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  tooltip: (key: string) => TooltipItem | undefined;
}

const I18nContext = createContext<I18nContextValue>({
  lang: 'ko',
  setLang: () => {},
  t: (k, p) => translate(k, p, 'ko'),
  tooltip: (k) => getTooltip(k, 'ko'),
});

export const I18nProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<Language>(detectDefaultLanguage);

  const setLang = useCallback((newLang: Language) => {
    setLangState(newLang);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, newLang);
      window.dispatchEvent(new CustomEvent('hdm-language-changed', { detail: newLang }));
    }
  }, []);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === 'ko' || e.newValue === 'en')) {
        setLangState(e.newValue);
      }
    };
    const handleCustom = (e: Event) => {
      const customEvent = e as CustomEvent<Language>;
      if (customEvent.detail === 'ko' || customEvent.detail === 'en') {
        setLangState(customEvent.detail);
      }
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('hdm-language-changed', handleCustom);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('hdm-language-changed', handleCustom);
    };
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => translate(key, params, lang),
    [lang]
  );

  const tooltip = useCallback((key: string) => getTooltip(key, lang), [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t, tooltip }}>
      {children}
    </I18nContext.Provider>
  );
};

export const useI18n = (): I18nContextValue => useContext(I18nContext);

/**
 * Audit helper to verify that Korean and English translation dictionaries
 * have identical key sets.
 */
export function auditTranslationCompleteness(): {
  missingInKo: string[];
  missingInEn: string[];
  totalKeys: number;
} {
  const koKeys = Object.keys(ko);
  const enKeys = Object.keys(en);

  const missingInEn = koKeys.filter((k) => !enKeys.includes(k));
  const missingInKo = enKeys.filter((k) => !koKeys.includes(k));

  return {
    missingInKo,
    missingInEn,
    totalKeys: koKeys.length,
  };
}
