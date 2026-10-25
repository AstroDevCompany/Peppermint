// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { MozLitElement } from "chrome://global/content/lit-utils.mjs";
import { html } from "chrome://global/content/vendor/lit.all.mjs";

/**
 * The credits row of the About pane: the MintFlow logo, who made the browser
 * and the version that is running.
 */
class PeppermintAbout extends MozLitElement {
  static properties = {
    version: { type: String },
  };

  constructor() {
    super();

    /** @type {string} */
    this.version = "";
  }

  render() {
    return html`
      <link
        rel="stylesheet"
        href="chrome://browser/content/preferences/widgets/peppermint-about.css"
      />
      <div class="credits">
        <img
          class="logo"
          src="chrome://browser/content/zen-images/mintflow-logo.webp"
          data-l10n-id="peppermint-about-logo"
        />
        <div class="text">
          <strong data-l10n-id="peppermint-about-developer"></strong>
          <span class="deemphasized" data-l10n-id="peppermint-about-lead"></span>
          <a
            href="https://mintflow.dev"
            target="_blank"
            data-l10n-id="peppermint-about-link"
          ></a>
        </div>
        <span
          class="version deemphasized"
          data-l10n-id="peppermint-about-version"
          data-l10n-args=${JSON.stringify({ version: this.version })}
        ></span>
      </div>
    `;
  }
}
customElements.define("peppermint-about", PeppermintAbout);
