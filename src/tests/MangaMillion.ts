import { ContentRating, DiscoverSectionType, type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { MangaMillion, MangaMillionExtension } from "../MangaMillion/main.js";
import sourceInfo from "../MangaMillion/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MangaMillion tests", logger);
  registerDefaultTests(suite, MangaMillion, sourceInfo, {
    searchResultsProviding: {
      getSearchResults: [{ title: "One Piece" }, undefined, undefined],
    },
    mangaProviding: {
      getMangaDetails: ["1"],
    },
  });

  suite.test("search sends the text parameter", async () => {
    let requestPath = "";
    const extension = Object.assign(new MangaMillionExtension(), {
      apiRequest: (path: string) => {
        requestPath = path;
        return Promise.resolve(new ArrayBuffer(0));
      },
    });

    await extension.getSearchResults({ title: "  One Piece & friends  " });

    expect(requestPath).to.match(/^\/search\?/);
    expect(requestPath).to.include("&text=One%20Piece%20%26%20friends");
    expect(requestPath).not.to.include("&q=");

    await extension.getSearchResults({ title: "   " });
    expect(requestPath).to.match(/^\/manga_list\?/);
  });

  suite.test("search narrows the catalogue", async () => {
    const catalogue = await MangaMillion.getSearchResults({ title: "" });
    const results = await MangaMillion.getSearchResults({ title: "One Piece" });

    expect(catalogue.items.length).to.be.greaterThan(0);
    expect(results.items.length).to.be.greaterThan(0);
    expect(results.items.length).to.be.lessThan(catalogue.items.length);
  });

  suite.test("all titles are alphabetical without mutating catalogue order", async () => {
    const titles = ["Zebra", "banana", "Apple", "Blue Exorcist"];
    const items = titles.map((title, index) => ({
      mangaId: String(index),
      title,
      imageUrl: "",
      contentRating: ContentRating.EVERYONE,
    }));
    const extension = Object.assign(new MangaMillionExtension(), {
      getSearchResults: () => Promise.resolve({ items }),
    });

    const results = await extension.getDiscoverSectionItems({
      id: "all_titles",
      title: "All Titles",
      type: DiscoverSectionType.simpleCarousel,
    });

    expect(results.items.map((item) => item.title)).to.deep.equal([
      "Apple",
      "banana",
      "Blue Exorcist",
      "Zebra",
    ]);
    expect(items.map((item) => item.title)).to.deep.equal(titles);
    expect(results.items.map((item) => item.mangaId)).to.deep.equal(["2", "1", "3", "0"]);
  });

  await suite.run();
}
