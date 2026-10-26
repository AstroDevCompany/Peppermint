# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Report page (about:report)

peppermint-report-title = Peppermint report

peppermint-report-periods =
    .aria-label = Time period
peppermint-report-period-week = This week
peppermint-report-period-month = This month
peppermint-report-period-year = This year

peppermint-report-trackers = Trackers blocked
peppermint-report-banners = Cookie banners handled
peppermint-report-active = Time browsing
peppermint-report-unloaded = Idle tabs unloaded
peppermint-report-archived = Tabs archived

# $hours (Number) - whole hours; $minutes (Number) - minutes past the hour.
peppermint-report-duration = { $hours } h { $minutes } min

# $size (String) - an amount of memory with its unit, such as 1.5 GB.
peppermint-report-memory = About { $size } of memory freed

peppermint-report-top-sites = Most visited sites
# $count (Number) - how many times the site was visited.
peppermint-report-visits =
    { $count ->
        [one] { $count } visit
       *[other] { $count } visits
    }
peppermint-report-no-sites = No sites visited in this period.

peppermint-report-share = Share
peppermint-report-share-description = Turn this period into an image to post or send. It only contains the numbers above.
peppermint-report-copy-image = Copy image
peppermint-report-save-image = Save image
# $name (String) - the name of the file that was saved in Downloads.
peppermint-report-saved = Saved to Downloads as { $name }
peppermint-report-copied = Image copied to the clipboard
peppermint-report-share-error = The image could not be made
peppermint-report-file-name = Peppermint report

peppermint-report-share-title-week = My week with Peppermint
peppermint-report-share-title-month = My month with Peppermint
peppermint-report-share-title-year = My year with Peppermint
peppermint-report-brand = Peppermint Browser

peppermint-report-footer = Counted on this device only. Private windows are never counted.
