import { type TestLogger } from "@paperback/types";

import { MangaMillion } from "../MangaMillion/main.js";
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

  await suite.run();
}
