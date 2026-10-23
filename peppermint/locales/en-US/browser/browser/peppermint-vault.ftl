# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

## Opt-in dialog, shown from the password settings

peppermint-vault-prompt-title = Turn on Peppermint Vault?
peppermint-vault-prompt-message =
    Vault keeps your saved passwords behind a Primary Password, so anyone using this computer needs it to view or fill them.

    Your Primary Password is not stored anywhere, and Peppermint cannot reset or recover it. If you forget it, you will permanently lose access to everything it protects. The only way forward is to erase that data and start over.
peppermint-vault-prompt-continue = Continue
peppermint-vault-prompt-not-now = Not now

## Page

peppermint-vault-title = Peppermint Vault
peppermint-vault-unavailable = Vault is not available because your organization turned off the password manager.
peppermint-vault-cancel = Cancel
peppermint-vault-sections-label =
    .aria-label = Sections

## Lock screen and password confirmation

peppermint-vault-locked-title = Vault is locked
peppermint-vault-locked-description = Enter your Primary Password to see your saved data.
peppermint-vault-lock-reason-idle = Vault locked after a period of inactivity.
peppermint-vault-lock-reason-manual = Vault was locked.
peppermint-vault-lock-reason-sleep = Vault locked when the computer went to sleep.
peppermint-vault-lock-reason-hidden = Vault locked because its tab stayed in the background.
peppermint-vault-confirm-title = Confirm it is you
peppermint-vault-confirm-description = Enter your Primary Password to continue.
peppermint-vault-primary-password = Primary Password
peppermint-vault-unlock = Unlock
peppermint-vault-error-empty = Enter a password.
peppermint-vault-error-wrong-password = That password is not correct.
peppermint-vault-error-wait =
    { $seconds ->
        [one] Too many attempts. Try again in { $seconds } second.
       *[other] Too many attempts. Try again in { $seconds } seconds.
    }
peppermint-vault-error-no-password = No Primary Password is set.

## Setup

peppermint-vault-setup-title = Set up Peppermint Vault
peppermint-vault-setup-description = Vault protects your saved passwords with a Primary Password and locks itself when you are away.
peppermint-vault-needs-password-title = Vault needs a Primary Password
peppermint-vault-needs-password-description = The Primary Password was removed, so Vault is locked out. Set a new one to continue.
peppermint-vault-recovery-warning = Your Primary Password is not stored anywhere and cannot be recovered or reset by Peppermint. If you forget it, you permanently lose access to everything it protects. The only way forward is to erase that data and start over.
peppermint-vault-new-password = New Primary Password
peppermint-vault-confirm-password = Repeat the Primary Password
peppermint-vault-strength-none = Enter a password
peppermint-vault-strength-weak = Weak
peppermint-vault-strength-fair = Fair
peppermint-vault-strength-good = Good
peppermint-vault-strength-strong = Strong
peppermint-vault-acknowledge = I understand that a forgotten Primary Password cannot be recovered.
peppermint-vault-setup-turn-on = Turn on Vault
peppermint-vault-setup-restore = Set Primary Password
peppermint-vault-error-acknowledge = Confirm that you understand before continuing.
peppermint-vault-error-too-short = Use at least { $min } characters.
peppermint-vault-error-mismatch = The two passwords do not match.
peppermint-vault-error-set-failed = The Primary Password could not be set.
peppermint-vault-error-policy = Your organization does not allow setting a Primary Password.
peppermint-vault-toast-ready = Vault is on.
peppermint-vault-toast-ready-short = Vault is on. Your Primary Password is short, so consider changing it to a longer one.

## Shell

peppermint-vault-lock-now = Lock now
peppermint-vault-settings = Password settings
peppermint-vault-turn-off = Turn off Vault
peppermint-vault-turn-off-confirm = Click again to turn off

## Logins

peppermint-vault-section-logins = Logins
peppermint-vault-field-username = Username
peppermint-vault-field-password = Password
peppermint-vault-field-website = Website
peppermint-vault-no-value = No username
peppermint-vault-insecure = Not secure
peppermint-vault-search =
    .placeholder = Search
    .aria-label = Search
peppermint-vault-filter-label =
    .aria-label = Filter
peppermint-vault-sort-label =
    .aria-label = Sort
peppermint-vault-filter-all = All
peppermint-vault-filter-insecure = Not secure
peppermint-vault-filter-no-username = No username
peppermint-vault-sort-title = Name
peppermint-vault-sort-recent-use = Recently used
peppermint-vault-sort-recent-change = Recently changed
peppermint-vault-sort-recent-add = Recently added
peppermint-vault-result-count =
    { $count ->
        [one] { $count } result
       *[other] { $count } results
    }
peppermint-vault-empty-title = Nothing saved yet
peppermint-vault-empty-description = Logins you save while browsing show up here.
peppermint-vault-no-results = No matches.
peppermint-vault-add = Add

peppermint-vault-reveal =
    .aria-label = Show password for { $site }
    .title = Show password
peppermint-vault-hide =
    .aria-label = Hide password for { $site }
    .title = Hide password
peppermint-vault-copy-username =
    .aria-label = Copy username for { $site }
    .title = Copy username
peppermint-vault-copy-password =
    .aria-label = Copy password for { $site }
    .title = Copy password
peppermint-vault-edit =
    .aria-label = Edit login for { $site }
    .title = Edit
peppermint-vault-toast-copied = Copied.
peppermint-vault-toast-copied-cleared =
    { $seconds ->
        [one] Copied. It is cleared from the clipboard in { $seconds } second.
       *[other] Copied. It is cleared from the clipboard in { $seconds } seconds.
    }

## Edit and add dialogs

peppermint-vault-edit-title = Edit login
peppermint-vault-add-title = Add login
peppermint-vault-save = Save
peppermint-vault-add-submit = Add
peppermint-vault-delete = Delete
peppermint-vault-delete-confirm = Click again to delete
peppermint-vault-show-password =
    .aria-label = Show password
    .title = Show password
peppermint-vault-hide-password =
    .aria-label = Hide password
    .title = Hide password

## Errors

peppermint-vault-error-exists = A login with this website and username already exists.
peppermint-vault-error-invalid-origin = Enter a valid website address.
peppermint-vault-error-empty-password = The password cannot be empty.
peppermint-vault-error-not-found = This login no longer exists.
peppermint-vault-error-reveal-blocked = Your organization does not allow showing passwords.
peppermint-vault-error-generic = Something went wrong.

## One-time codes

peppermint-vault-section-codes = One-time codes
peppermint-vault-field-account = Account
peppermint-vault-field-code = Code
peppermint-vault-field-service = Service
peppermint-vault-field-setup-key = Setup key or otpauth:// address
peppermint-vault-codes-add-title = Add one-time code
peppermint-vault-codes-edit-title = Edit one-time code
peppermint-vault-codes-empty-title = No one-time codes yet
peppermint-vault-codes-empty-description = Add the setup key a service shows next to its QR code, or paste the otpauth:// address. Codes change every 30 seconds.
peppermint-vault-codes-error-exists = A code for this service and account already exists.
peppermint-vault-error-invalid-secret = That setup key is not valid. Use the letters and digits the service shows, or its otpauth:// address.

# $site (String) - the service the code is for.
peppermint-vault-copy-code =
    .title = Copy the code for { $site }
    .aria-label = Copy the code for { $site }

## Timestamps

# $date (String) - a date and time such as "Oct 23, 2026, 9:41 AM".
peppermint-vault-time-created = Saved { $date }
peppermint-vault-time-changed = Password changed { $date }
peppermint-vault-time-used = Last used { $date }
peppermint-vault-time-modified = Changed { $date }
peppermint-vault-time-event = { $date }

## Website permissions

peppermint-vault-section-permissions = Permissions
peppermint-vault-section-permission-history = Permission history
peppermint-vault-field-permission = Permission
peppermint-vault-field-change = Change
peppermint-vault-permissions-empty-title = No permissions set
peppermint-vault-permissions-empty-description = When you allow or block something for a website, such as the camera, location or notifications, it shows up here and you can change it at any time.
peppermint-vault-permissions-filter-allowed = Allowed
peppermint-vault-permissions-filter-blocked = Blocked
peppermint-vault-permissions-filter-location = Location
peppermint-vault-permissions-filter-camera = Camera
peppermint-vault-permissions-filter-microphone = Microphone
peppermint-vault-permissions-filter-notifications = Notifications
peppermint-vault-permissions-session = Until Peppermint closes
peppermint-vault-permissions-managed = Set by your organization
peppermint-vault-permissions-error-read-only = Your organization set this permission, so it cannot be changed.
peppermint-vault-permissions-error-invalid-state = That choice is not available for this permission.
peppermint-vault-toast-saved = Saved.

# $permission (String) - for example "Camera".
# $site (String) - the website.
peppermint-vault-choice-label =
    .aria-label = { $permission } for { $site }

# $site (String) - the website.
peppermint-vault-permissions-reset =
    .aria-label = Reset all permissions for { $site }
    .title = Reset all permissions
peppermint-vault-permissions-reset-confirm =
    .aria-label = Confirm resetting all permissions for { $site }
    .title = Click again to reset

## Permission history

peppermint-vault-history-empty-title = No changes recorded yet
peppermint-vault-history-empty-description = From now on, every time a website permission is allowed, blocked or reset, the change is listed here with the time it happened. Private windows are never recorded.
peppermint-vault-history-filter-reset = Reset
peppermint-vault-history-sort-newest = Newest first
peppermint-vault-history-sort-oldest = Oldest first
peppermint-vault-history-clear = Clear history
peppermint-vault-history-clear-confirm = Click again to clear
