export type Language = 'ko' | 'en';

export interface TooltipItem {
  title: string;
  body: string;
  shortcut?: string;
  note?: string;
}

export interface I18nDictionary {
  [key: string]: string | TooltipItem | I18nDictionary;
}
