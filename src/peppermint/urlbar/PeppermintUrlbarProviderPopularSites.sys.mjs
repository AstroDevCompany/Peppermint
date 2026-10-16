/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { UrlbarProvider } from "moz-src:///browser/components/urlbar/UrlbarUtils.sys.mjs";
import { ProvidersManager } from "moz-src:///browser/components/urlbar/UrlbarProvidersManager.sys.mjs";
import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  UrlbarResult: "chrome://browser/content/urlbar/UrlbarResult.mjs",
  UrlbarShared: "chrome://browser/content/urlbar/UrlbarShared.mjs",
});

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "enabled",
  "peppermint.urlbar.popular-sites.enabled",
  true
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "maxResults",
  "peppermint.urlbar.popular-sites.max-results",
  3
);
XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "minQueryLength",
  "peppermint.urlbar.popular-sites.min-query-length",
  2
);

const DATA_URL =
  "chrome://browser/content/peppermint-urlbar/popular-sites.json";
const PROVIDER_NAME = "PeppermintUrlbarProviderPopularSites";

// Letters, digits and hyphens, optionally followed by a dot and more of the
// same: what a person types while heading for a domain name.
const DOMAIN_PREFIX = /^[a-z0-9-]+(\.[a-z0-9.-]*)?$/;

let gSites = null;

/**
 * @returns {Promise<{domain: string, label: string}[]>}
 *   The popular domains, most popular first. `label` is the part before the
 *   first dot, which is the name people type ("youtube" for youtube.com).
 */
function loadSites() {
  gSites ??= fetch(DATA_URL)
    .then(response => response.json())
    .then(domains =>
      domains.map(domain => ({ domain, label: domain.split(".")[0] }))
    )
    .catch(error => {
      console.error("Could not load the popular sites list", error);
      gSites = null;
      return [];
    });
  return gSites;
}

/**
 * Reduces the search string to the domain prefix it may stand for, or returns
 * null when the string is something else (several words, a path, a search).
 *
 * @param {string} searchString
 *   The trimmed, lower case search string.
 * @returns {string|null}
 */
export function popularSitesQuery(searchString) {
  let query = searchString.replace(/^https?:\/\//, "").replace(/^www\./, "");
  return DOMAIN_PREFIX.test(query) ? query : null;
}

/**
 * Finds the most popular domains a query could be the start of. A query
 * without a dot matches the beginning of the name ("yout") as well as the
 * beginning of the domain; a query with a dot only the latter ("youtube.c").
 * A name that is already listed (google.com, google.de) appears only once.
 *
 * @param {{domain: string, label: string}[]} sites
 * @param {string} query
 * @param {number} limit
 * @returns {string[]}
 */
export function matchPopularSites(sites, query, limit) {
  let matches = [];
  let labels = new Set();
  for (let { domain, label } of sites) {
    let isMatch = query.includes(".")
      ? domain.startsWith(query)
      : label.startsWith(query);
    if (isMatch && !labels.has(label)) {
      labels.add(label);
      matches.push(domain);
      if (matches.length >= limit) {
        break;
      }
    }
  }
  return matches;
}

/**
 * Suggests well known sites, ranked by popularity, for queries that look like
 * the start of a domain. Sites the user has been to are already covered by the
 * history and autofill providers, so this only fills the gap for new ones.
 */
export class PeppermintUrlbarProviderPopularSites extends UrlbarProvider {
  get name() {
    return PROVIDER_NAME;
  }

  get type() {
    return lazy.UrlbarShared.PROVIDER_TYPE.PROFILE;
  }

  async isActive(queryContext) {
    if (
      !lazy.enabled ||
      queryContext.searchMode ||
      queryContext.restrictToken ||
      !queryContext.sources.includes(
        lazy.UrlbarShared.RESULT_SOURCE.OTHER_LOCAL
      )
    ) {
      return false;
    }
    let query = popularSitesQuery(queryContext.trimmedLowerCaseSearchString);
    return !!query && query.length >= lazy.minQueryLength;
  }

  async startQuery(queryContext, addCallback) {
    let query = popularSitesQuery(queryContext.trimmedLowerCaseSearchString);
    let sites = await loadSites();
    for (let domain of matchPopularSites(sites, query, lazy.maxResults)) {
      let url = `https://${domain}/`;
      addCallback(
        this,
        new lazy.UrlbarResult({
          type: lazy.UrlbarShared.RESULT_TYPE.URL,
          source: lazy.UrlbarShared.RESULT_SOURCE.OTHER_LOCAL,
          payload: {
            title: domain,
            url,
            icon: lazy.UrlbarShared.getIconForUrl(url),
            // Below everything the user's own history can offer.
            frecency: 0,
          },
          highlights: {
            title: lazy.UrlbarShared.HIGHLIGHT.TYPED,
            url: lazy.UrlbarShared.HIGHLIGHT.TYPED,
          },
        })
      );
    }
  }
}

export function registerPopularSitesProvider() {
  let manager = ProvidersManager.getInstanceForSap("urlbar");
  if (!manager.getProvider(PROVIDER_NAME)) {
    manager.registerProvider(new PeppermintUrlbarProviderPopularSites());
  }
}
