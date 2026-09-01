/* SPDX-License-Identifier: GPL-3.0-or-later */

import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";

export default {
  name: "MangaMillion",
  description: "Extension that pulls content from mangamillion.shueisha.co.jp.",
  version: "1.0.0-alpha.1",
  icon: "icon-v2.png",
  language: "en",
  contentRating: ContentRating.EVERYONE,
  capabilities: [
    SourceIntents.CHAPTER_PROVIDING,
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SETTINGS_FORM_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
  ],
  badges: [],
  developers: [
    {
      name: "Aksdenn",
      github: "https://github.com/aksdenn",
    },
  ],
} satisfies ExtensionInfo;
