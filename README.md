<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="branding-art/peppermint-full.png">
    <img src="branding-art/peppermint-full.png" alt="Fresh News" width="200">
  </picture>
</p>

<div align="center">

# Peppermint

**A performant, productive Firefox-based browser. Built for focus, convenience & speed.**

_Peppermint is an independent fork._

[![License: MPL-2.0](https://img.shields.io/badge/License-MPL_2.0-brightgreen.svg)](https://opensource.org/licenses/MPL-2.0)
[![Firefox Version](https://img.shields.io/badge/Firefox-158.0-orange.svg)](https://www.mozilla.org/firefox/)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](https://github.com/AstroDevCompany/Peppermint/actions)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg)](https://github.com/AstroDevCompany/Peppermint/releases)

[📥 Download Latest Release](https://github.com/AstroDevCompany/Peppermint/releases/latest) • [🐛 Report Bug](https://github.com/AstroDevCompany/Peppermint/issues/new?template=bug_report.md) • [💡 Request Feature](https://github.com/AstroDevCompany/Peppermint/issues/new?template=feature_request.md) • [📖 Documentation](https://github.com/AstroDevCompany/Peppermint/wiki)

</div>

---

## Before we begin

**Read this if you're worried about "AI slop". I would be too, so I get you.**

MintFlow Technologies is simply a brand name I came up with to make my products feel more "unified". I'm a solo developer, I work on my projects only in my free time, I don't earn anything from them, and I've been very interested in the LLM world ever since the 2023 boom. I've been trying to fine-tune & benchmark LLMs since then.

I'm not planning to add any AI-based features to this browser, as that would mostly defeat its "fast & light, clutter-free" premise. That said, of course, many of these features have been developed with assistance from LLM agents, sometimes through fully AI-driven workflows. Nevertheless, **I aim to use the strongest, smartest models available while carefully examining and double-checking their work**. Since I always keep an eye on every LLM release, bechmarks + my own tests, you can trust I'll be using the best LLMs at all times.

This applies to most of my products (not all of them, but almost). So, while there's always a chance something might slip under my nose, you can generally trust the changes being made.

This isn't my biggest project, not even close, but it's still the one I **care about the most**. I've dreamed of making a browser for as long as I can remember, simply because it's something I use every day and, by far, my most-used app on any desktop. That means you can generally trust that, with Peppermint, you'll get the version of a browser I've always wanted for myself, improved every time I come up with a new idea (and if you have any, feel free to reach out. Thanks!).

With that said, thank you for taking the time to read this, and first and foremost, for choosing Peppermint.

Oh, and I'm also pouring a decent amount of money into these agents and being a university students with 0 earnings, trust that I'll do my best to put them to good use.

---

## ✨ Why Peppermint?

Modern browsers focus too much on adding useless features that you'll maybe end up using once, instead of focusing on actual QoL features that will make your experience more enjoyable & hassle-free; No telemetry, sponsored shortcuts, and UI that fights for your attention. **Peppermint strips it all away and only focuses on making your experience smoother.**

|       🎯 **Focus First**        |      🛡️ **Privacy by Default**      |  ⚡ **Performance Tuned**  |
| :-----------------------------: | :---------------------------------: | :------------------------: |
|     Zen-inspired minimal UI     | No telemetry, no studies, no pocket | Optimized startup & memory |
|   Vertical tabs that breathe    |   Hardened `user.js` preferences    |  PGO/LTO optimized builds  |
| Command palette for power users |       uBlock Origin built-in        |  Native vertical tab bar   |

---

## Highlight features

- Tab Islands
- Custom temporary markdown editor (MD Notepad) with integrated encrypted saving
- URL Snippets
- Underpowered mode
- Advanced idle resource consumption reduction
- Cookie blocker & auto-refusal
- Auto ad-blocker setup system
- Temporary permissions
- Peppermint Janitor (opt-in space saver that clears stale temp files, caches and traces on launch)
- Rich homepage
- Light & Fast
- More secure Ghost mode
- Polished frosted glass UI
- No telemetry

### Improved upon Zen

- All Highlight Features
- More organized settings
- More consistent panels colors & design
- Additional settings
- Minor QoL features
- Default themes & settings

---

### Known issues

- No QR code passkey sign-in on MacOS

[Temporary Fixes](KITF.md)

---

### TODOs

[] Replace the integrated ad-blocker with an ad-blocker auto-install & suggestion system
[] Create fully isolated containers (highly requested, apparently)

---

## If you're not interested in the source-code or contributing, you can stop here.

---

## 🚀 Quick Start

### Prerequisites

- **Node.js** ≥ 20.10.0
- **Python** ≥ 3.11
- **Rust** ≥ 1.78 (for `ffprefs` tool)
- **Git** with LFS support
- Platform build tools:
  - **Windows**: Visual Studio 2022 + Windows 10 SDK
  - **macOS**: Xcode Command Line Tools
  - **Linux**: `build-essential`, `pkg-config`, `gtk3-devel`, `libasound2-dev`

### One-Command Setup

```bash
# Clone with submodules
git clone --recurse-submodules https://github.com/AstroDevCompany/Peppermint.git peppermint
cd peppermint

# Guided first build (macOS/Linux)
./scripts/run-macos.sh

# Or Windows
.\scripts\run-windows.ps1
```

### Manual Build

```bash
# Install dependencies
npm ci

# Download Firefox source + apply patches
npm run init

# Development build (fast, unoptimized)
npm run build:ui

# Production build (optimized, PGO)
npm run build

# Run from source
npm start
```

---

### Key Technologies

| Layer            | Technology                                               |
| ---------------- | -------------------------------------------------------- |
| **Engine**       | Firefox 158 (Gecko)                                      |
| **UI Framework** | React 18 + TypeScript                                    |
| **Styling**      | CSS Variables + Custom Properties                        |
| **Build System** | [Surfer](https://github.com/zen-browser/surfer) (custom) |
| **Patching**     | Quilt-style patch stacks                                 |
| **Preferences**  | `ffprefs` (Rust) + JSON schemas                          |

---

## 🎨 Features Deep Dive

### Vertical Tab Bar (Native)

Not a sidebar extension, but a **native C++ implementation** integrated into the browser chrome. Smooth animations, collapsible groups, and keyboard-first navigation.

### Command Palette (`Ctrl/Cmd + K`)

Fuzzy-search everything: tabs, history, bookmarks, settings, and custom actions. Extensible via `browser.commands` API.

### Theme System

- **Light / Dark / Auto** (system preference)
- **Custom themes** via CSS variables
- **Accent colors** with live preview
- **Compact / Comfortable / Spacious** density modes

### Hardened Preferences (`prefs/`)

```javascript
// Telemetry & studies (disabled)
"datareporting.healthreport.uploadEnabled": false,
"toolkit.telemetry.enabled": false,
"app.shield.studies.enabled": false,

// Privacy (strengthened)
"network.cookie.cookieBehavior": 4,        // Total cookie protection
"privacy.trackingprotection.enabled": true,
"dom.security.https_only_mode": true,

// Performance
"browser.sessionstore.interval": 120000,   // Less frequent session saves
"config.trim_on_minimize": true,           // Release memory when minimized
```

### Built-in uBlock Origin

Manifest V3 compatible, auto-updated, zero-config. Toggle per-site from the toolbar.

### Live Folders (Experimental)

Smart bookmark folders that auto-populate from queries: `tag:work`, `domain:github.com`, `visited:>7d`.

---

## 🤝 Contributing

We welcome contributions! Please read our [Contributing Guide](docs/contribute.md) and [Code of Conduct](CODE_OF_CONDUCT.md) first.

### Development Workflow

```bash
# 1. Fork & clone
git clone https://github.com/YOUR_FORK/desktop.git
cd desktop

# 2. Create feature branch
git checkout -b feat/amazing-feature dev

# 3. Make changes, test locally
npm run build:ui && npm start

# 4. Lint & format
npm run lint:fix

# 5. Submit PR to `dev` branch
```

### Branch Strategy

```
dev (main) ◄──────────────────────────────────────┐
  │                                               │
  ├── feat/* (feature branches)                   │
  │                                               │
  ▼                                               │
twilight (feature integration)                    │
  │                                               │
  ▼                                               │
stable (release) ──── Hotfixes ──────────────────┘
```

---

## 🔧 Advanced Configuration

### Adding Custom Patches

```bash
# 1. Create patch file
mkdir -p src/external-patches/my-feature
# Add .patch files here

# 2. Register in surfer.json "patches" array
# 3. Rebuild
npm run import && npm run build
```

---

## 📦 Distribution (CS...)

### Official Builds

- **Windows**: `.exe` installer + `.mar` updates
- **macOS**: `.dmg` (universal) + `.mar` updates
- **Linux**: `.tar.xz` + `.mar` updates + Flatpak (community)

### Self-Hosted Updates

Configure `updateHostname` in `surfer.json` and deploy MAR files to your server.

---

## 🛡️ Security

- **Security Policy**: [SECURITY.md](SECURITY.md)
- **Report Vulnerabilities**: [security@peppermint.invalid](mailto:security@peppermint.invalid) (PGP key in SECURITY.md)
- **Dependencies**: Audited via `npm audit` + `cargo audit` in CI

---

## 📄 License

**Mozilla Public License 2.0**; see [LICENSE](LICENSE) or [MPL-2.0](https://www.mozilla.org/MPL/2.0/).

> This project incorporates code from:
>
> - [Mozilla Firefox](https://github.com/mozilla/gecko-dev) (MPL-2.0)
> - [Zen Browser](https://github.com/zen-browser/desktop) (MPL-2.0)
> - [LibreWolf](https://gitlab.com/librewolf-community/browser) (MPL-2.0)
> - [arkenfox user.js](https://github.com/arkenfox/user.js) (Unlicense)

---

## 🙏 Acknowledgments

<div align="center">

| Project                                         | Contribution                               |
| ----------------------------------------------- | ------------------------------------------ |
| [Mozilla](https://mozilla.org/)                 | Firefox engine & platform                  |
| [Zen Browser](https://zen-browser.app/)         | Upstream fork base & Surfer build system   |
| [LibreWolf](https://librewolf.net/)             | Privacy patches & hardened prefs reference |
| [arkenfox](https://github.com/arkenfox/user.js) | Privacy preference templates               |
| [uBlock Origin](https://ublockorigin.com/)      | Built-in content blocking                  |

</div>

---
