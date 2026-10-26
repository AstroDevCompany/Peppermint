urlbar-search-mode-snippets = Snippets

zen-ghost-mode-button =
    .label = Ghost Mode
    .tooltiptext = Open a new Ghost Window

zen-ghost-mode-notice-toast = This is a Ghost window

zen-ghost-mode-notice-toast-description = Browsing history, cookies and site data are erased when the last Ghost window closes. Downloaded files stay on disk, and your network and the sites you visit can still see you.

zen-underpowered-button =
    .label = Underpowered Mode
    .tooltiptext = Freeze background tabs and limit resource use

zen-underpowered-enabled-toast = Underpowered Mode on

zen-underpowered-enabled-toast-description = Background tabs are frozen to save power

zen-underpowered-battery-toast-description = The battery is low. Background tabs are frozen to save power

zen-underpowered-resources-toast-description = CPU or memory use is very high. Background tabs are frozen to save power

zen-underpowered-disabled-toast = Underpowered Mode off

zen-underpowered-disabled-toast-description = Background tabs reload when you open them

zen-underpowered-auto-disabled-toast-description = Conditions are back to normal. Background tabs reload when you open them

peppermint-janitor-prompt-title = Peppermint Janitor

peppermint-janitor-prompt-message = Free up disk space every time { -brand-short-name } starts? The Janitor clears temporary files, usage traces, leftover update files and app caches that nothing has used for 72 hours. Your documents, downloads and browser data are never touched. You can change this at any time in Settings.

peppermint-janitor-prompt-enable = Enable the Janitor

peppermint-janitor-prompt-not-now = Not now

peppermint-janitor-toast-temp = Temporary files cleared

peppermint-janitor-toast-traces = Usage traces cleared

peppermint-janitor-toast-updates = Update leftovers cleared

peppermint-janitor-toast-caches = App caches cleared

peppermint-janitor-toast-trash = { PLATFORM() ->
    [windows] Recycle bin emptied
   *[other] Trash emptied
}

# $size (String) - amount of space that was freed, for example "1.4 GB".
peppermint-janitor-toast-description = { $size } freed

peppermint-janitor-toast-nothing = Already tidy

peppermint-janitor-toast-nothing-description = There was nothing to clean

peppermint-janitor-toast-errors = Some items could not be cleaned

peppermint-janitor-toast-errors-description = They may be in use or locked by another program

# $minutes (Number) - whole minutes remaining on a temporary grant.
zen-site-data-setting-allow-timed = Allowed for { $minutes } min

zen-site-data-setting-allow-brief = Allowed for less than a minute

zen-site-data-setting-allow-tab = Until this tab closes

zen-permission-duration-label = Allow for

zen-permission-duration-once =
    .label = This time

zen-permission-duration-timed =
    .label = For 10 minutes

zen-permission-duration-tab =
    .label = Until this tab closes

zen-permission-duration-always =
    .label = Always

# $count (Number) - cookie popups refused or hidden on this page.
zen-site-data-cookie-consent-count = { $count } handled

zen-site-data-cookie-consent = Cookie popups

zen-site-data-cookie-consent-pause = This site

zen-site-data-cookie-consent-on = Refusing

zen-site-data-cookie-consent-paused = Paused

zen-homepage-welcome = Welcome back, { $name }.

zen-homepage-today = Today is { $date }.

zen-homepage-tagline = Have a <span data-l10n-name="fresh">fresh</span> browsing experience!

zen-homepage-card-time-spent = Time spent browsing

zen-homepage-card-top-site = Most used website

zen-homepage-card-network-speed = Avg. Network Speed

zen-homepage-card-downloads = Nº Downloads

zen-homepage-card-visited-sites = Nº Visited websites

zen-homepage-card-version = Current Version

zen-homepage-card-report = Protected This Week

# Variables:
#   $shortcut (String): The keyboard shortcut that toggles compact mode.
peppermint-toggle-compact-mode-button-shortcut =
    .label = Compact Mode
    .tooltiptext = Toggle Compact Mode ({ $shortcut })

# Variables:
#   $tabCount (Number): The number of tabs that will be closed.
#   $shortcut (String): The keyboard shortcut that closes the tab.
peppermint-tab-close-button-shortcut =
    .tooltiptext =
        { $tabCount ->
            [one] Close tab ({ $shortcut })
           *[other] Close { $tabCount } tabs ({ $shortcut })
        }

# Variables:
#   $tabCount (Number): -1 when the tab is in a split view, otherwise the
#   number of tabs that will be joined.
peppermint-tab-split-button =
    .label =
        { $tabCount ->
            [-1] Split Out Tab
            [1] Add Split View...
           *[other] Join { $tabCount } Tabs
        }
    .tooltiptext =
        { $tabCount ->
            [-1] Split Out Tab
            [1] Add Split View...
           *[other] Join { $tabCount } Tabs
        }
