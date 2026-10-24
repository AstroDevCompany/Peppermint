// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  SearchService: "moz-src:///toolkit/components/search/SearchService.sys.mjs",
});

const ENGINE_NAME = "Mintch";
const ENGINE_ALIAS = "mintch";
const URL_PREF = "peppermint.search.mintch.url";
const DEFAULT_VERSION_PREF = "peppermint.search.mintch.default-version";

// Raise to make Mintch the default engine again on profiles that changed it.
const DEFAULT_VERSION = 1;

function searchTemplate(path) {
  const origin = Services.prefs.getStringPref(URL_PREF).replace(/\/+$/, "");
  return `${origin}${path}?q={searchTerms}`;
}

/**
 * Makes Mintch available and, once per DEFAULT_VERSION, the default engine.
 * The engine is a user engine, so it survives search config updates; after
 * the default was applied the user stays free to change it.
 */
class PeppermintSearchService {
  #ready = null;

  init() {
    this.#ready ??= this.#setup().catch(error =>
      console.error("PeppermintSearch failed", error)
    );
    return this.#ready;
  }

  async #setup() {
    await lazy.SearchService.init();

    const engine = await this.#ensureEngine();
    if (
      Services.prefs.getIntPref(DEFAULT_VERSION_PREF, 0) >= DEFAULT_VERSION
    ) {
      return;
    }
    await this.#makeDefault(engine);
    Services.prefs.setIntPref(DEFAULT_VERSION_PREF, DEFAULT_VERSION);
  }

  async #ensureEngine() {
    const search = searchTemplate("/search");
    let engine = lazy.SearchService.getEngineByName(ENGINE_NAME);
    if (engine && this.#urlMatches(engine, search)) {
      return engine;
    }

    // The configured origin changed (a new release, another host).
    let wasDefault = false;
    if (engine) {
      wasDefault = engine === (await lazy.SearchService.getDefault());
      await lazy.SearchService.removeEngine(
        engine,
        lazy.SearchService.CHANGE_REASON.UNKNOWN
      );
    }
    engine = await lazy.SearchService.addUserEngine({
      name: ENGINE_NAME,
      alias: ENGINE_ALIAS,
      url: search,
      suggestUrl: searchTemplate("/autocompleter"),
    });
    if (wasDefault) {
      await this.#makeDefault(engine);
    }
    return engine;
  }

  #urlMatches(engine, template) {
    const probe = "peppermint-probe";
    const expected = template.replace("{searchTerms}", probe);
    return engine.getSubmission(probe)?.uri.spec === expected;
  }

  async #makeDefault(engine) {
    await lazy.SearchService.setDefault(
      engine,
      lazy.SearchService.CHANGE_REASON.UNKNOWN
    );
    await lazy.SearchService.moveEngine(engine, 0);
  }
}

export const PeppermintSearch = new PeppermintSearchService();
