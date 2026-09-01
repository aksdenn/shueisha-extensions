/* SPDX-License-Identifier: GPL-3.0-or-later */

import { ButtonRow, Form, Section, SelectRow } from "@paperback/types";

export const DEFAULT_LANGUAGE = "en";

// Matches the languages MANGA MILLION actually publishes translated chapters in.
export const SUPPORTED_LANGUAGES: Record<string, string> = {
  en: "English",
  ja: "日本語",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  "ko-KR": "한국어",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  "pt-BR": "Português (BR)",
  ru: "Русский",
  th: "ภาษาไทย",
  vi: "Tiếng Việt",
  id: "Bahasa Indonesia",
};

export const getLanguage = (): string => {
  return (Application.getState("language") as string) ?? DEFAULT_LANGUAGE;
};

export class MangaMillionSettingForm extends Form {
  override getSections() {
    return [
      Section("content_settings", [
        SelectRow("language", {
          title: "Language",
          value: [getLanguage()],
          minItemCount: 1,
          maxItemCount: 1,
          options: Object.entries(SUPPORTED_LANGUAGES).map(([id, title]) => ({ id, title })),
          onValueChange: Application.Selector(this as MangaMillionSettingForm, "setLanguage"),
        }),
      ]),
      Section("reset_settings", [
        ButtonRow("reset", {
          title: "Reset to Default",
          onSelect: Application.Selector(this as MangaMillionSettingForm, "resetSettings"),
        }),
      ]),
    ];
  }

  async setLanguage(value: string[]): Promise<void> {
    Application.setState(value.length > 0 ? value[0] : DEFAULT_LANGUAGE, "language");
  }

  async resetSettings(): Promise<void> {
    Application.setState(DEFAULT_LANGUAGE, "language");
  }
}
