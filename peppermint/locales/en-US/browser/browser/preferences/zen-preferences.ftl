# peppermint: remove pane-zen-looks-title
# peppermint: remove category-zen-looks
# peppermint: remove pane-zen-tabs-title
# peppermint: remove category-zen-workspaces
# peppermint: remove pane-settings-workspaces-title
# peppermint: remove pane-zen-pinned-tab-manager-title
# peppermint: remove pane-zen-theme-title
# peppermint: remove zen-theme-marketplace-header
# peppermint: remove zen-theme-disable-all-enabled
# peppermint: remove zen-theme-disable-all-disabled
# peppermint: remove zen-theme-marketplace-description
# peppermint: remove zen-theme-marketplace-remove-button
# peppermint: remove zen-theme-marketplace-check-for-updates-button
# peppermint: remove zen-theme-marketplace-import-button
# peppermint: remove zen-theme-marketplace-export-button
# peppermint: remove zen-theme-marketplace-import-success
# peppermint: remove zen-theme-marketplace-import-failure
# peppermint: remove zen-theme-marketplace-export-success
# peppermint: remove zen-theme-marketplace-export-failure
# peppermint: remove zen-theme-marketplace-updates-success
# peppermint: remove zen-theme-marketplace-updates-failure
# peppermint: remove zen-theme-marketplace-toggle-enabled-button
# peppermint: remove zen-theme-marketplace-toggle-disabled-button
# peppermint: remove zen-theme-marketplace-remove-confirmation
# peppermint: remove zen-theme-marketplace-close-modal
# peppermint: remove zen-theme-marketplace-theme-header-title
# peppermint: remove zen-theme-marketplace-dropdown-default-label
# peppermint: remove zen-theme-marketplace-input-default-placeholder
# peppermint: remove pane-zen-marketplace-title
# peppermint: remove zen-themes-auto-update
# peppermint: remove zen-theme-marketplace-link
# peppermint: remove category-zen-marketplace

pane-zen-homepage-title = Homepage

category-zen-homepage =
    .tooltiptext = { pane-zen-homepage-title }

pane-zen-sidebar-layout-title = Sidebar & layout

category-zen-sidebar-layout =
    .tooltiptext = { pane-zen-sidebar-layout-title }

pane-zen-toolbar-urlbar-title = Toolbar & address bar

category-zen-toolbar-urlbar =
    .tooltiptext = { pane-zen-toolbar-urlbar-title }

pane-zen-spaces-tabs-title = Spaces & tabs

category-zen-spaces-tabs =
    .tooltiptext = { pane-zen-spaces-tabs-title }

pane-zen-adblock-title = Ad blocking

category-zen-adblock =
    .tooltiptext = { pane-zen-adblock-title }

pane-zen-performance-title = Performance and effects

category-zen-performance =
    .tooltiptext = { pane-zen-performance-title }

pane-zen-janitor-title = Janitor

category-zen-janitor =
    .tooltiptext = { pane-zen-janitor-title }

pane-zen-shortcuts-title = Shortcuts

category-zen-shortcuts =
    .tooltiptext = { pane-zen-shortcuts-title }

pane-zen-url-snippets-title = URL Snippets

category-zen-url-snippets =
    .tooltiptext = { pane-zen-url-snippets-title }

zen-sidebar-layout-section-title = Sidebar & layout

zen-tab-list-section-title = Tab list

zen-compact-toolbar-section-title = Compact toolbar

zen-address-bar-section-title = Address bar

zen-tab-switching-section-title = Tab switching

zen-tab-switching-header = Tab switching behavior

zen-tab-switching-description = Control how tabs are selected when you close tabs or cycle with Ctrl+Tab.

zen-pinned-essentials-section-title = Pinned tabs & essentials

zen-glance-section-title = Link preview

zen-split-view-settings-section-title = Split view

zen-settings-spaces-sync-footer =
    Workspace sync is managed in your Mozilla account settings.
    <a data-l10n-name="sync-link">Open Sync settings</a>

zen-library-settings-title = Library

zen-library-settings-header = General settings for the library

zen-library-settings-description = Choose which section opens when you use the library button in the sidebar.

zen-library-default-section-label = Default section

zen-library-default-section-downloads =
    .label = Downloads

zen-library-default-section-history =
    .label = History

zen-library-default-section-boosts =
    .label = Boosts

zen-library-default-section-spaces =
    .label = Spaces

zen-library-default-section-media =
    .label = Media

zen-glance-header = Glance

zen-split-view-settings-header = Split view

zen-split-view-settings-description = Control how split view appears in the tab strip.

zen-split-view-show-tab-split-button =
    .label = Show split view button on tabs

zen-pinned-tab-manager-header = Pinned tabs

zen-settings-workspaces-header = Spaces

zen-vertical-tabs-title = Tab list

zen-vertical-tabs-header = Tab list options

zen-urlbar-title = Address bar

zen-urlbar-header = Address bar

zen-theme-glass-enabled =
    .label = Frosted glass

zen-adblock-section-title = Ad blocking

zen-adblock-header = Ad blocker

zen-adblock-description = { -brand-short-name } blocks ads with an extension of your choice. The one you pick is installed right away and replaces the previous one.

zen-adblock-choice-label = Ad blocker

zen-adblock-status-installed = Installed and ready.

zen-adblock-status-installing = Installing...

zen-adblock-status-missing = Not installed.

zen-adblock-status-failed = The ad blocker could not be installed. Check your connection and try again.

zen-adblock-install =
    .label = Install now

# $count (Number) - how many cookie popups were handled so far.
zen-cookie-consent-status = { $count ->
        [one] 1 cookie popup handled so far.
       *[other] { $count } cookie popups handled so far.
    }

zen-cookie-consent-header = Cookie popups

zen-cookie-consent-description = Refuse cookie popups on every site and hide any that stay on screen. This works with any ad blocker, and you can pause it for one site from the site panel.

zen-cookie-consent-enabled =
    .label = Automatically refuse cookie popups

zen-site-exceptions-header = Site exceptions

zen-site-exceptions-description = Sites where cookie popup refusal differs from your global setting. Removing a site returns it to your defaults.

zen-site-exceptions-empty = No sites have exceptions yet. Use the site panel next to the address bar to add one.

zen-site-exceptions-clear =
    .label = Remove all

# $site (String) - the site the exceptions apply to, for example "example.com".
zen-site-exceptions-remove =
    .label = Remove
    .aria-label = Remove exceptions for { $site }

zen-site-exceptions-cookies = Cookie popups left alone

pane-zen-CKS-title = Shortcuts

category-zen-CKS =
    .tooltiptext = { pane-zen-shortcuts-title }

pane-settings-CKS-title = { -brand-short-name } shortcuts

zen-settings-notepad-header = Notepad

zen-settings-notepad-description = Choose the key that confirms a suggestion in the local notepad. Tab is the default, and it only applies while the suggestion menu is open.

zen-settings-notepad-autocomplete = Confirm suggestion

zen-settings-notepad-reset =
    .label = Reset

# Keyboard navigation: Tab either switches tabs or moves focus in the page.
tab-key-behavior =
    .label = Tab key

tab-key-behavior-tabs =
    .label = Use the tab key without CTRL to move between tabs

tab-key-behavior-focus =
    .label = Use the tab key to move focus between form controls and links

zen-homepage-section-title = Homepage

zen-homepage-header = Homepage

zen-homepage-description = Choose what appears when you open a new tab.

zen-homepage-mode-builtin =
    .label = Built-in homepage

zen-homepage-mode-blank =
    .label = Nothing

zen-homepage-mode-custom =
    .label = Custom URL

zen-homepage-url-label = Homepage URL

zen-homepage-url-invalid = Enter a valid http or https URL.

zen-homepage-cards-header = Cards

zen-homepage-cards-description = Choose which cards appear on the built-in homepage.

zen-homepage-card-time-spent-toggle =
    .label = Time spent browsing

zen-homepage-card-top-site-toggle =
    .label = Most used website

zen-homepage-card-network-speed-toggle =
    .label = Avg. Network Speed

zen-homepage-card-downloads-toggle =
    .label = Nº Downloads

zen-homepage-card-visited-sites-toggle =
    .label = Nº Visited websites

zen-homepage-card-version-toggle =
    .label = Current Version

zen-homepage-card-clock-toggle =
    .label = Clock

zen-url-snippets-section-title = URL Snippets

zen-url-snippets-header = URL Snippets

zen-url-snippets-description = Type > followed by a shortcut in the address bar to open its URL. For example, >yt opens YouTube.

zen-url-snippets-shortcut-label = Shortcut

zen-url-snippets-url-label = URL

zen-url-snippets-add =
    .label = Add snippet

zen-url-snippets-remove =
    .label = Remove

zen-url-snippets-shortcut-input =
    .placeholder = yt

zen-url-snippets-url-input =
    .placeholder = https://youtube.com

zen-performance-section-title = Performance and effects

zen-performance-header = Performance and effects

zen-performance-description = Turn off motion and effects you do not use. Idle tabs unload in the background after the time below. Use 0 to keep every tab loaded.

zen-performance-space-switch =
    .label = Animate switching spaces

zen-performance-download-animation =
    .label = Download animation

zen-performance-grey-out-inactive =
    .label = Grey out inactive windows

zen-performance-haptics =
    .label = Haptic feedback

zen-performance-essentials-favicon =
    .label = Background behind essential icons

zen-tab-unloader-minutes-label = Unload idle tabs after

zen-tab-unloader-minutes-description = Minutes. Pinned tabs, essentials, the tab you are viewing, and tabs playing sound stay loaded.

zen-underpowered-auto-header = Underpowered Mode

zen-underpowered-auto-resources =
    .label = Turn on automatically when CPU or RAM use is very high

zen-underpowered-auto-resources-description = Starts when CPU or RAM use reaches 90% and stays there. Turns itself off again once both have stayed under 90% for 30 seconds. A session you started yourself is never turned off.

zen-underpowered-auto-battery =
    .label = Turn on automatically when the battery is low

zen-underpowered-auto-battery-description = Starts when the battery is below { $percent }% and not charging. Turns itself off when you plug in. A session you started yourself is never turned off.

zen-underpowered-when-unplugged =
    .label = Also turn on whenever the battery is not charging

zen-underpowered-battery-threshold-label = Battery counts as low below (%)

zen-underpowered-resource-threshold-label = CPU or memory load counts as heavy at (%)

zen-underpowered-grace-label = Freeze a background tab after (seconds)

zen-underpowered-never-freeze-label = Never freeze these sites

zen-underpowered-never-freeze-description = One site per line, for example mail.example.com. Tabs on these sites, and their subdomains, keep running in Underpowered Mode.

zen-underpowered-status-off = Underpowered Mode is off.

# $count (Number) - how many background tabs are frozen right now.
zen-underpowered-status-on = Underpowered Mode is on. { $count ->
        [one] 1 background tab is frozen.
       *[other] { $count } background tabs are frozen.
    }

zen-janitor-section-title = Peppermint Janitor

zen-janitor-header = Free up disk space on launch

zen-janitor-description = Every time { -brand-short-name } starts, the Janitor clears files that nothing has used for 72 hours. Your documents, downloads and browser data are never touched.

zen-janitor-enabled =
    .label = Clean automatically

zen-janitor-schedule-label = Clean

zen-janitor-schedule-startup =
    .label = On every launch

zen-janitor-schedule-daily =
    .label = Once a day

zen-janitor-schedule-weekly =
    .label = Once a week

zen-janitor-clean-header = What to clean

zen-janitor-clean-temp =
    .label = Temporary files

zen-janitor-clean-traces =
    .label = Usage traces (crash reports, old logs, recent item lists)

zen-janitor-clean-updates =
    .label = Leftover update files

zen-janitor-clean-caches =
    .label = App caches not used in the last 72 hours

zen-janitor-clean-recycle-bin =
    .label = { PLATFORM() ->
        [windows] Empty the recycle bin
       *[other] Empty the Trash
    }

zen-janitor-recycle-bin-description = { PLATFORM() ->
    [windows] Files in the recycle bin cannot be restored afterwards. Off by default.
   *[other] Files in the Trash cannot be restored afterwards. Off by default.
}

zen-janitor-notifications =
    .label = Show a notification for every location that was cleaned

zen-janitor-clean-now =
    .label = Clean now

# $date (String) - when the Janitor last ran, for example "Oct 18, 2026, 3:04 PM".
# $size (String) - the space it freed, for example "1.4 GB".
zen-janitor-last-run = Last cleaned { $date }: { $size } freed.

zen-janitor-never-run = The Janitor has not cleaned anything yet.

# $size (String) - the space freed in total, for example "12.3 GB".
# $count (Number) - how many cleanings that adds up.
zen-janitor-totals = { $count ->
    [one] { $size } freed in { $count } cleaning.
   *[other] { $size } freed in { $count } cleanings.
}

## Peppermint Vault, in the password settings

peppermint-vault-settings-set-up =
    .label = Set up Peppermint Vault
    .description = Protect your saved passwords with a Primary Password and an automatic lock.

peppermint-vault-settings-open =
    .label = Open Peppermint Vault
    .description = Vault is on. The Primary Password cannot be turned off while it is on.

sync-currently-syncing-notes = Notes

sync-engine-notes =
    .label = Notes
    .tooltiptext = Sync your notes across devices
    .accesskey = N

pane-zen-ghost-mode-title = Ghost Mode

category-zen-ghost-mode =
    .tooltiptext = { pane-zen-ghost-mode-title }

zen-ghost-mode-section-title = Ghost Mode

zen-ghost-mode-header = Ghost windows

zen-ghost-mode-description = A Ghost window does not keep your history, cookies or site data once the last Ghost window is closed.

zen-ghost-mode-delete-downloads =
    .label = Delete files downloaded in Ghost windows when they close

zen-ghost-mode-delete-downloads-description = Only files that finished downloading in a Ghost window are removed, and only if you have not changed them. Off by default, so downloads stay on disk.

zen-ghost-mode-search-suggestions =
    .label = Show search suggestions in Ghost windows

zen-ghost-mode-search-suggestions-description = Suggestions send what you type to your search engine while you type. Off by default in Ghost windows.

zen-ghost-mode-resist-fingerprinting =
    .label = Resist fingerprinting in Ghost windows

zen-ghost-mode-resist-fingerprinting-description = Makes your browser look the same as other browsers to websites. Some sites may show the wrong time zone or window size, or break.

zen-ghost-mode-protects-header = What Ghost windows protect

zen-ghost-mode-protects-history = Browsing history, cookies, cache, form data and site storage are erased when the last Ghost window closes, and Ghost tabs are never restored after a restart.

zen-ghost-mode-protects-tracking = Trackers, cross-site cookies and known tracking parameters in links are blocked, and { -brand-short-name } sends a Global Privacy Control signal.

zen-ghost-mode-protects-notepad = Notepad does not save notes written in a Ghost window, and Reader does not save articles for offline reading from one.

zen-ghost-mode-limits-header = What they do not protect

zen-ghost-mode-limits-network = Your network provider, your employer and the sites you visit can still see your connection. A Ghost window does not hide your IP address.

zen-ghost-mode-limits-downloads = Downloaded files and bookmarks you save stay on disk unless you remove them.

zen-ghost-mode-limits-extensions = Extensions only run in Ghost windows if you allow them to.

peppermint-about-heading =
    .label = About
    .description = { -brand-short-name } is a Firefox-based browser built around speed, privacy and a calm workspace. Your data stays on your computer unless you turn on sync or choose a service that needs the network.

peppermint-about-logo =
    .alt = MintFlow

peppermint-about-developer = Developed by MintFlow Technologies

peppermint-about-lead = Lead developer: Luca Montanari

peppermint-about-link = mintflow.dev

# $version (String) - the { -brand-short-name } version, such as 2026.0.2.
peppermint-about-version = { -brand-short-name } { $version }

peppermint-tabs-confirm-close-button =
    .label = Ask for confirmation when closing a tab through the close button

peppermint-tabs-confirm-close-middle-click =
    .label = Also ask for confirmation when closing a tab with middle click

peppermint-tabs-islands =
    .label = Group tabs opened from a tab into an island
