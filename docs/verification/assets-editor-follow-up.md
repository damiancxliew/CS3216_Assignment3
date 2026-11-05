# Assets editor follow-up

Asset selection, removal and bundled-sprite changes now save immediately to the draft through
the existing authorized, version-checked edit service. Uploads and generated results remain
reviewable candidates until the teacher chooses **Use image** or **Use sheet**. A separate
story Save is no longer needed for an asset change; Publish remains explicit.

Pending story edits are replayed over the newly saved asset version and remain unsaved. Discarding
story edits retains the saved asset. Failed asset saves leave the previous selection available,
display the server error and allow retry. Asset controls are disabled during a save.

The file picker now opens from the existing primary button style, including keyboard activation.
Caption/alternative-text requirements and format restrictions are unchanged.

The saved validation-context schema now accepts optional slanted-document `stageId`, matching
generation output and allowing already affected adventures to open again without rewriting data.
Older context without stage IDs remains valid. Unreadable adventures also offer a Back to
adventures button.

Verification: API/unit suites (604 tests), spec suite (64 tests), web/spec TypeScript checks,
targeted ESLint, and the real Chromium editor fixture. The browser fixture replaces server
transport; it verifies selection persistence, save conflict/retry, pending story preservation,
discard, reload, mobile layout and keyboard file selection, not staging authentication/storage.
No database migrations are required. Staging acceptance remains a separate check.
