# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Archived and snoozed tabs found by the address bar

# $date (String) - when the tab was archived.
peppermint-archive-result-archived = Archived { $date }
# $date (String) - when the tab comes back.
peppermint-archive-result-snoozed = Snoozed until { $date }
peppermint-archive-restore = Restore

## Archive page (about:archive)

peppermint-archive-title = Tab archive

peppermint-archive-search =
    .placeholder = Search archived tabs
    .aria-label = Search archived tabs

peppermint-archive-tabs =
    .aria-label = Show archived or snoozed tabs

# $count (Number) - how many tabs are archived.
peppermint-archive-tab-archived = Archived ({ $count })
# $count (Number) - how many tabs are snoozed.
peppermint-archive-tab-snoozed = Snoozed ({ $count })

peppermint-archive-clear-all = Clear all
peppermint-archive-clear-confirm = Click again to clear

peppermint-archive-restore-button =
    .tooltiptext = Restore tab
    .aria-label = Restore tab
peppermint-archive-remove-button =
    .tooltiptext = Remove from archive
    .aria-label = Remove from archive

# $space (String) - the name of the Space the tab was in.
peppermint-archive-space = In { $space }
peppermint-archive-no-space = No Space

# $date (String) - when the tab was archived.
peppermint-archive-archived-on = Archived { $date }
# $date (String) - when the tab comes back.
peppermint-archive-wakes-on = Comes back { $date }

peppermint-archive-group-today = Today
peppermint-archive-group-yesterday = Yesterday
peppermint-archive-group-earlier = Earlier

peppermint-archive-empty-title = Nothing archived
# $hours (Number) - how many idle hours archive a tab.
peppermint-archive-empty-description = Tabs that sit idle for { $hours } hours are archived here, and you can snooze a tab from the command palette.
peppermint-archive-empty-off-description = Tabs are not archived automatically. You can archive or snooze a tab from the command palette.
peppermint-archive-no-results = No archived tabs match your search.
peppermint-archive-private = The tab archive is not available in private windows.
peppermint-archive-restore-error = That tab could not be restored.
