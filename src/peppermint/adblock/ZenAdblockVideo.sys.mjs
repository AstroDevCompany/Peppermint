// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

const MAX_REWRITE_BYTES = 8 * 1024 * 1024;

const AD_KEY = /"(?:adPlacements|adSlots|playerAds)"/g;

// Runs in the page. Renames ad fields in player JSON and in the objects
// YouTube assigns before the player reads them. List scriptlets cover the
// anti-adblock workaround; this covers the ad payload itself.
export const VIDEO_PAGE_HOOK = `
(function () {
  if (window.__zenAdblockVideo) {
    return;
  }
  window.__zenAdblockVideo = true;
  const AD_KEY = /"(?:adPlacements|adSlots|playerAds)"/g;
  const API = /\\/(?:youtubei\\/v1\\/(?:player|get_watch|next|reel)|playlist)(?:\\?|$)|\\/watch\\?/;
  function strip(text) {
    if (typeof text !== "string" || text.length < 12 || text.indexOf('"ad') === -1) {
      return text;
    }
    return text.replace(AD_KEY, '"no_ads"');
  }
  function prune(value) {
    if (!value || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        prune(value[i]);
      }
      return;
    }
    delete value.adPlacements;
    delete value.playerAds;
    delete value.adSlots;
    if (value.playerResponse) {
      prune(value.playerResponse);
    }
  }
  function hookProp(name) {
    let stored = window[name];
    if (stored) {
      try { prune(stored); } catch (e) {}
    }
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: true,
        get() { return stored; },
        set(value) {
          try { prune(value); } catch (e) {}
          stored = value;
        },
      });
    } catch (e) {}
  }
  hookProp("ytInitialPlayerResponse");
  hookProp("ytInitialData");
  const parse = JSON.parse;
  JSON.parse = function (text, reviver) {
    if (typeof text === "string") {
      text = strip(text);
    }
    return parse.call(this, text, reviver);
  };
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input) {
      const url = typeof input === "string" ? input : (input && input.url) || "";
      const pending = origFetch.apply(this, arguments);
      if (!API.test(String(url))) {
        return pending;
      }
      return pending.then(function (response) {
        return response.clone().text().then(function (text) {
          const next = strip(text);
          if (next === text) {
            return response;
          }
          return new Response(next, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        }).catch(function () { return response; });
      });
    };
  }
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function (_method, url) {
      try { this.__zenAdUrl = String(url || ""); } catch (e) {}
      return open.apply(this, arguments);
    };
    XHR.prototype.send = function () {
      try {
        if (API.test(this.__zenAdUrl || "")) {
          this.addEventListener("readystatechange", function () {
            if (this.readyState !== 4 || typeof this.responseText !== "string") {
              return;
            }
            const next = strip(this.responseText);
            if (next === this.responseText) {
              return;
            }
            try {
              Object.defineProperty(this, "responseText", { configurable: true, get: function () { return next; } });
              Object.defineProperty(this, "response", { configurable: true, get: function () { return next; } });
            } catch (e) {}
          });
        }
      } catch (e) {}
      return send.apply(this, arguments);
    };
  }
  // Some accounts get a full-page "ad blockers violate the Terms of Service"
  // screen under a status other than UNPLAYABLE. The retry in the filter lists
  // only looks for UNPLAYABLE, so it never starts for them. This runs the same
  // retry: put a marker in the client's user agent (the lists' request rules
  // key on it) and load the video again, trying each marker once.
  (function () {
    // Temporary: a short trace of what this did, for sessionStorage
    // "zen-adblock-wall-log", read while the wall is being debugged.
    function trace(step) {
      try {
        const old = sessionStorage.getItem("zen-adblock-wall-log") || "";
        sessionStorage.setItem("zen-adblock-wall-log", (old + " " + step).slice(-600));
      } catch (e) {}
    }
    trace("hook@" + Math.round(performance.now() / 1000) + "s");
    const MARKERS = ["lactmilli", "inline", "yahi", "channel"];
    const ALL = MARKERS.concat([]);
    let remaining = MARKERS.slice();
    let handled = null;
    function clientContext() {
      const config = window.ytcfg && window.ytcfg.data_;
      return config && config.INNERTUBE_CONTEXT && config.INNERTUBE_CONTEXT.client;
    }
    function setMarker(marker) {
      const client = clientContext();
      if (!client || typeof client.userAgent !== "string") {
        return;
      }
      let agent = client.userAgent;
      for (const known of ALL) {
        agent = agent.split("; " + known + ")").join(")");
      }
      const end = agent.indexOf(")");
      client.userAgent =
        marker && end > 0 ? agent.slice(0, end) + "; " + marker + agent.slice(end) : agent;
    }
    function check() {
      const player = document.getElementById("movie_player");
      if (!player || typeof player.getPlayerResponse !== "function") {
        return;
      }
      let response;
      try {
        response = player.getPlayerResponse();
      } catch (e) {
        return;
      }
      const status = response && response.playabilityStatus;
      if (!status || status === handled || status.status === "UNPLAYABLE") {
        return;
      }
      if (!status.errorScreen || !status.errorScreen.enforcementMessageViewModel) {
        return;
      }
      handled = status;
      trace("seen:" + status.status + "/" + remaining.length);
      if (!remaining.length) {
        setMarker("");
        remaining = MARKERS.slice();
        console.info("Peppermint: YouTube's ad wall stays after every retry");
        trace("exhausted");
        // The page's tab can now be allowed to play (see ZenAdblockChild).
        window.dispatchEvent(new CustomEvent("zen-adblock-wall"));
        return;
      }
      const marker = remaining.shift();
      console.info("Peppermint: YouTube's ad wall is showing, retrying as " + marker);
      setMarker(marker);
      trace("retry:" + marker);
      const videoId = response.videoDetails && response.videoDetails.videoId;
      const config = response.playerConfig && response.playerConfig.playbackStartConfig;
      if (videoId && typeof player.loadVideoById === "function") {
        player.loadVideoById(videoId, (config && config.startSeconds) || 0);
      }
    }
    setInterval(check, 1000);
  })();
})();
`;

// Scripts for a few hosts are handed to every content process ahead of time,
// so they can run in the first moments of a document, before the page's own
// scripts. Asking the main process takes a round trip, and by the time the
// answer arrives the page has already run its first inline scripts: too late
// to rewrite them or to hook APIs the page then freezes.
export const EARLY_SCRIPTS_INDEX = "zen-adblock:early-index";
const EARLY_SCRIPTS_BUNDLE = "zen-adblock:early:";

export function earlyBundleKey(index) {
  return EARLY_SCRIPTS_BUNDLE + index;
}

export function isEarlyScriptsKey(key) {
  return key === EARLY_SCRIPTS_INDEX || key.startsWith(EARLY_SCRIPTS_BUNDLE);
}

export function parseEarlyHosts(text) {
  return String(text || "")
    .split(",")
    .map(host => host.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Hosts that end up with the same scripts share one bundle, so the scriptlet
 * code is stored once however many hosts use it.
 *
 * @param {string[]} hosts
 * @param {(host: string) => string[] | null} resolve Scripts for a host, or
 *   nothing when the host should not get any.
 * @returns {{hosts: {[host: string]: number}, bundles: string[][]}}
 */
export function buildEarlyScriptTable(hosts, resolve) {
  const table = { hosts: {}, bundles: [] };
  const byContent = new Map();
  for (const host of hosts) {
    const scripts = resolve(host);
    if (!scripts?.length) {
      continue;
    }
    const content = scripts.join("\n\u0000\n");
    let index = byContent.get(content);
    if (index === undefined) {
      index = table.bundles.push(scripts) - 1;
      byContent.set(content, index);
    }
    table.hosts[host] = index;
  }
  return table;
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isYouTubeHost(hostname) {
  // Runs for every request, and every host this matches contains "youtube".
  if (!hostname) {
    return false;
  }
  const lower = hostname.toLowerCase();
  if (!lower.includes("youtube")) {
    return false;
  }
  const host = lower.replace(/\.$/, "");
  return (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtube-nocookie.com" ||
    host.endsWith(".youtube-nocookie.com") ||
    host === "youtubekids.com" ||
    host.endsWith(".youtubekids.com") ||
    host === "youtubei.googleapis.com" ||
    host.endsWith(".youtubei.googleapis.com")
  );
}

export function needsVideoPageHook(url) {
  return isYouTubeHost(hostnameOf(url));
}

/**
 * Requests that only exist to serve or measure a video ad.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function isVideoAdRequest(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  if (host === "imasdk.googleapis.com" || host.endsWith(".imasdk.googleapis.com")) {
    return true;
  }
  if (host === "dmxleo.dailymotion.com") {
    return true;
  }
  if (!isYouTubeHost(host)) {
    return false;
  }
  return (
    path.startsWith("/pagead") ||
    path.startsWith("/ptracking") ||
    path.startsWith("/get_midroll") ||
    path.startsWith("/api/stats/ads")
  );
}

/**
 * Player and watch JSON only. HTML documents also contain the player
 * script, and renaming keys there would rename the code that reads them.
 *
 * @param {string} url
 * @param {string} [contentType]
 * @returns {boolean}
 */
export function shouldRewriteVideoAdResponse(url, contentType = "") {
  const type = String(contentType).split(";")[0].trim().toLowerCase();
  if (
    type.startsWith("text/html") ||
    type.startsWith("video/") ||
    type.startsWith("audio/") ||
    type.startsWith("image/")
  ) {
    return false;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!isYouTubeHost(parsed.hostname)) {
    return false;
  }
  const path = parsed.pathname;
  if (
    path.includes("/youtubei/v1/player") ||
    path.includes("/youtubei/v1/get_watch") ||
    path.includes("/youtubei/v1/next") ||
    path.includes("/youtubei/v1/reel")
  ) {
    return true;
  }
  if (!type.includes("json")) {
    return false;
  }
  return path === "/playlist" || path === "/watch";
}

export function rewriteVideoAdBody(text) {
  if (typeof text !== "string" || text.length < 12 || !text.includes('"ad')) {
    return text;
  }
  return text.replace(AD_KEY, '"no_ads"');
}

export class VideoAdStreamListener {
  constructor(channel) {
    this.chunks = [];
    this.received = 0;
    this.overflow = false;
    this.forwarded = 0;
    this.originalListener = channel.setNewListener(this);
  }

  onStartRequest() {}

  onDataAvailable(request, stream, _offset, count) {
    if (this.overflow) {
      // Past the rewrite limit the body is no longer buffered: it streams
      // straight through, so a chunked response cannot grow without bound.
      this.originalListener.onDataAvailable(request, stream, this.forwarded, count);
      this.forwarded += count;
      return;
    }
    const binary = Cc["@mozilla.org/binaryinputstream;1"].createInstance(
      Ci.nsIBinaryInputStream
    );
    binary.setInputStream(stream);
    const bytes = binary.readBytes(count);
    this.received += bytes.length;
    this.chunks.push(bytes);
    if (this.received > MAX_REWRITE_BYTES) {
      this.overflow = true;
      this.#flushBuffered(request);
    }
  }

  /**
   * Hands everything buffered so far to the page unchanged and starts
   * forwarding. The original listener has not seen onStartRequest yet.
   */
  #flushBuffered(request) {
    const body = this.chunks.join("");
    this.chunks = [];
    try {
      this.originalListener.onStartRequest(request);
      const replacement = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(
        Ci.nsIStringInputStream
      );
      replacement.setByteStringData(body);
      this.originalListener.onDataAvailable(request, replacement, 0, body.length);
      this.forwarded = body.length;
    } catch (error) {
      console.error("ZenAdblock video response passthrough failed", error);
    }
  }

  onStopRequest(request, status) {
    if (this.overflow) {
      try {
        this.originalListener.onStopRequest(request, status);
      } catch (error) {
        console.error("ZenAdblock video response passthrough failed", error);
      }
      return;
    }
    let body = this.chunks.join("");
    this.chunks = [];
    if (!this.overflow && Components.isSuccessCode(status)) {
      try {
        body = rewriteVideoAdBody(body);
      } catch {
        // Keep the original bytes.
      }
    }
    try {
      if (request instanceof Ci.nsIHttpChannel) {
        request.setResponseHeader("Content-Length", String(body.length), false);
      }
    } catch {
      // Some responses freeze Content-Length.
    }
    const replacement = Cc["@mozilla.org/io/string-input-stream;1"].createInstance(
      Ci.nsIStringInputStream
    );
    try {
      replacement.setByteStringData(body);
    } catch {
      replacement.setData(body, body.length);
    }
    try {
      this.originalListener.onStartRequest(request);
      if (body.length) {
        this.originalListener.onDataAvailable(request, replacement, 0, body.length);
      }
      this.originalListener.onStopRequest(request, status);
    } catch (error) {
      console.error("ZenAdblock video response rewrite failed", error);
    }
  }

  QueryInterface = ChromeUtils.generateQI(["nsIStreamListener", "nsIRequestObserver"]);
}
