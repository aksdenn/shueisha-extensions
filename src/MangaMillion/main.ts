/* SPDX-License-Identifier: GPL-3.0-or-later */

import {
  ContentRating,
  DiscoverSectionType,
  type Chapter,
  type ChapterDetails,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Form,
  type PagedResults,
  type Metadata,
  type Request,
  type Response,
  type SearchQuery,
  type SearchResultItem,
  type SourceManga,
} from "@paperback/types";
import {
  SearchFilterForm,
  type SearchFilter,
  type SearchFilterValue,
} from "@paperback/types/lib/compat/0.8";
import type { AdvancedSearchForm } from "@paperback/types/lib/impl/interfaces/SearchResultsProviding";

import {
  chapterIdFromImageUrl,
  decryptPage,
  parseChapterList,
  parseMangaList,
  parseRegisterResponse,
  parseSearchParameters,
  parseSearchResults,
  parseTitleDetail,
  parseViewer,
  type MangaMillionChapter,
  type MangaMillionFilterOption,
  type MangaMillionSearchParameters,
} from "./MangaMillionHelper";
import { getLanguage, MangaMillionSettingForm } from "./MangaMillionSettings";
import type MangaMillionConfig from "./pbconfig";

const BASE_URL = "https://mangamillion.shueisha.co.jp";
const API_URL = "https://api.mangamillion.shueisha.co.jp/api";

export class MangaMillionExtension implements ExtensionImpl<typeof MangaMillionConfig> {
  // translated_chapter_id -> {aesKeyHex, aesIvHex}, populated by getChapterDetails and
  // consumed by interceptResponse when the page images for that chapter are fetched.
  private readonly viewerKeys = new Map<string, { aesKeyHex: string; aesIvHex: string }>();
  private searchParameters: Promise<MangaMillionSearchParameters> | undefined;

  async initialise(): Promise<void> {
    this.registerInterceptors();
  }

  registerInterceptors() {
    Application.registerInterceptor(
      "mangaMillionInterceptor",
      Application.Selector(this as MangaMillionExtension, "interceptRequest"),
      Application.Selector(this as MangaMillionExtension, "interceptResponse"),
    );
  }

  private async getAccessToken(): Promise<string> {
    const storedToken = Application.getState("accessToken") as string | undefined;
    if (storedToken) return storedToken;
    return this.registerAccessToken();
  }

  private async registerAccessToken(): Promise<string> {
    const response = (
      await Application.scheduleRequest({
        url: `${API_URL}/register`,
        method: "POST",
      })
    )[1];

    const token = parseRegisterResponse(response);
    if (!token) throw new Error("MangaMillion: failed to register device token");

    Application.setState(token, "accessToken");
    return token;
  }

  async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      "user-agent": await Application.getDefaultUserAgent(),
    };

    if (request.url.startsWith(API_URL) && !request.url.includes("/api/register")) {
      request.headers = {
        ...request.headers,
        Origin: BASE_URL,
        Referer: `${BASE_URL}/`,
        "Access-Token": await this.getAccessToken(),
      };
    }

    return request;
  }

  async interceptResponse(
    request: Request,
    _response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const chapterId = chapterIdFromImageUrl(request.url);
    const keys = chapterId ? this.viewerKeys.get(chapterId) : undefined;
    if (!keys) return data;

    try {
      return await decryptPage(data, keys.aesKeyHex, keys.aesIvHex);
    } catch {
      return data;
    }
  }

  // The API rejects a stale/invalid token with a 403; retry once after re-registering.
  private async apiRequest(path: string): Promise<ArrayBuffer> {
    const request = { url: `${API_URL}${path}`, method: "GET" };
    const [response, data] = await Application.scheduleRequest(request);

    if (response.status === 403) {
      Application.setState(undefined, "accessToken");
      return (await Application.scheduleRequest(request))[1];
    }

    return data;
  }

  // Cached per extension instance: the option lists rarely change within a session.
  private getSearchParameters(): Promise<MangaMillionSearchParameters> {
    this.searchParameters ??= this.apiRequest(
      `/search_parameter?service_language=${getLanguage()}&avif_enable=true`,
    ).then(parseSearchParameters);

    return this.searchParameters;
  }

  async getSearchFilters(): Promise<SearchFilter[]> {
    const parameters = await this.getSearchParameters();
    const toOptions = (options: MangaMillionFilterOption[]) =>
      options.map((option) => ({ id: option.id, value: option.name }));

    return [
      {
        type: "multiselect",
        id: "genre",
        title: "Genre",
        options: toOptions(parameters.genres),
        value: {},
        allowExclusion: false,
        allowEmptySelection: true,
        maximum: undefined,
      },
      {
        type: "multiselect",
        id: "theme",
        title: "Theme",
        options: toOptions(parameters.themes),
        value: {},
        allowExclusion: false,
        allowEmptySelection: true,
        maximum: undefined,
      },
      {
        type: "multiselect",
        id: "highlight",
        title: "Highlights",
        options: toOptions(parameters.highlights),
        value: {},
        allowExclusion: false,
        allowEmptySelection: true,
        maximum: undefined,
      },
      {
        type: "dropdown",
        id: "rating",
        title: "Rating",
        options: [{ id: "", value: "Any" }, ...toOptions(parameters.ratings)],
        value: "",
      },
    ];
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<AdvancedSearchForm> {
    return new SearchFilterForm(
      query.metadata as SearchFilterValue[] | undefined,
      this.getSearchFilters(),
    );
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    try {
      const data = await this.apiRequest(
        `/title_detail?service_language=${getLanguage()}&avif_enable=true&original_title_id=${mangaId}`,
      );
      const detail = parseTitleDetail(data);
      if (!detail) throw new Error("MangaMillion: empty title_detail response");

      return {
        mangaId,
        mangaInfo: {
          thumbnailUrl: detail.coverUrl,
          synopsis: detail.description,
          primaryTitle: detail.name,
          secondaryTitles: [],
          contentRating: ContentRating.EVERYONE,
          status: "Ongoing",
          author: detail.author,
          artist: detail.author,
          tagGroups:
            detail.tags.length > 0
              ? [
                  {
                    id: "genres",
                    title: "Genres",
                    tags: detail.tags.map((tag) => ({ id: tag.id, title: tag.name })),
                  },
                ]
              : [],
        },
      };
    } catch {
      return {
        mangaId,
        mangaInfo: {
          thumbnailUrl: "",
          synopsis: "",
          primaryTitle: mangaId,
          secondaryTitles: [],
          contentRating: ContentRating.EVERYONE,
          status: "Unknown",
          author: "",
          artist: "",
          tagGroups: [],
        },
      };
    }
  }

  private toChapter(
    chapter: MangaMillionChapter,
    sourceManga: SourceManga,
    langCode: string,
  ): Chapter {
    const chapNum = Number.parseFloat(chapter.number.replace(/[^\d.]/g, ""));

    return {
      chapterId: chapter.chapterId,
      sourceManga,
      langCode,
      chapNum: Number.isFinite(chapNum) ? chapNum : 0,
      title: chapter.name,
    };
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const language = getLanguage();
    try {
      const data = await this.apiRequest(
        `/chapter_list?service_language=${language}&avif_enable=true&original_title_id=${sourceManga.mangaId}&translated_language=${language}`,
      );

      return parseChapterList(data).map((chapter) =>
        this.toChapter(chapter, sourceManga, language),
      );
    } catch {
      return [];
    }
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const data = await this.apiRequest(
      `/viewer?service_language=${getLanguage()}&avif_enable=true&translated_chapter_id=${chapter.chapterId}&quality=low`,
    );

    const viewer = parseViewer(data);
    if (!viewer)
      throw new Error(`MangaMillion: failed to load viewer for chapter ${chapter.chapterId}`);

    this.viewerKeys.set(chapter.chapterId, {
      aesKeyHex: viewer.aesKeyHex,
      aesIvHex: viewer.aesIvHex,
    });

    return {
      id: chapter.chapterId,
      mangaId: chapter.sourceManga.mangaId,
      pages: viewer.pageUrls,
    };
  }

  private collectIncludedTagIds(filterValues: SearchFilterValue[], id: string): string[] {
    const value = filterValues.find((filter) => filter.id === id)?.value;
    if (!value || typeof value === "string") return [];

    return Object.entries(value)
      .filter(([, status]) => status === "included")
      .map(([tagId]) => tagId);
  }

  async getSearchResults(query: SearchQuery<Metadata>): Promise<PagedResults<SearchResultItem>> {
    const title = query.title?.trim();
    const language = getLanguage();
    const filterValues = (query.metadata as SearchFilterValue[] | undefined) ?? [];

    const tagIds = [
      ...this.collectIncludedTagIds(filterValues, "genre"),
      ...this.collectIncludedTagIds(filterValues, "theme"),
      ...this.collectIncludedTagIds(filterValues, "highlight"),
    ];
    const ratingValue = filterValues.find((filter) => filter.id === "rating")?.value;
    const ratingId = typeof ratingValue === "string" && ratingValue ? ratingValue : undefined;
    const hasFilters = tagIds.length > 0 || ratingId !== undefined;

    let query_ = `service_language=${language}&avif_enable=true`;
    if (title) query_ += `&q=${encodeURIComponent(title)}`;
    if (tagIds.length > 0) query_ += `&tag_id=${tagIds.join(",")}`;
    if (ratingId) query_ += `&rating_id=${ratingId}`;

    const useSearch = Boolean(title) || hasFilters;
    const path = useSearch ? `/search?${query_}` : `/manga_list?${query_}`;

    try {
      const data = await this.apiRequest(path);
      const results = useSearch ? parseSearchResults(data) : parseMangaList(data);

      return {
        items: results.map((result) => ({
          mangaId: result.titleId,
          title: result.name,
          subtitle: result.author,
          imageUrl: result.coverUrl,
          contentRating: ContentRating.EVERYONE,
        })),
      };
    } catch {
      return { items: [] };
    }
  }

  getDiscoverSections(): Promise<DiscoverSection[]> {
    return Promise.resolve([
      {
        id: "popular",
        title: "Popular",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: "all_titles",
        title: "All Titles",
        type: DiscoverSectionType.simpleCarousel,
      },
    ]);
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    let results: { titleId: string; name: string; author: string; coverUrl: string }[];

    if (section.id === "popular") {
      try {
        const data = await this.apiRequest(
          `/manga_list?service_language=${getLanguage()}&avif_enable=true`,
        );
        // `/api/manga_list` is returned in catalog (title id) order, not by popularity, so
        // rank it ourselves using each title's view count.
        results = [...parseMangaList(data)].sort((a, b) => b.views - a.views).slice(0, 30);
      } catch {
        results = [];
      }
    } else if (section.id === "all_titles") {
      results = (await this.getSearchResults({ title: "" })).items.map((item) => ({
        titleId: item.mangaId,
        name: item.title,
        author: item.subtitle ?? "",
        coverUrl: item.imageUrl,
      }));
    } else {
      return { items: [] };
    }

    return {
      items: results.map(
        (result) =>
          ({
            type: "simpleCarouselItem",
            mangaId: result.titleId,
            title: result.name,
            subtitle: result.author,
            imageUrl: result.coverUrl,
            contentRating: ContentRating.EVERYONE,
          }) as DiscoverSectionItem,
      ),
    };
  }

  async getSettingsForm(): Promise<Form> {
    return new MangaMillionSettingForm();
  }
}

export const MangaMillion = new MangaMillionExtension();
