# Privacy Policy — Persistent Downloads Button

**Effective date:** July 31, 2026

Persistent Downloads Button ("the extension") is a Chrome extension that
provides quick access to your recent downloads from a persistent toolbar
button. This policy describes how the extension handles user data.

## Summary

The extension does not collect, store, transmit, sell, or share any user
data. All processing happens locally on your device.

## Data the extension handles locally

To provide its features, the extension accesses the following data **on your
device only**:

- **Download history** — the extension reads your browser's download list
  (file names, sizes, dates, and states) via Chrome's `downloads` API in
  order to display your 50 most recent downloads in its popup.
- **Downloaded file contents** — when, and only when, you drag a file from
  the popup into a web page or click the popup's upload button, the extension
  reads that one file from disk solely to hand it to the page you chose, as
  if you had dropped it from your desktop. Files are never read at any other
  time and never for any other purpose.

This data never leaves your device. The extension makes no network requests
of any kind: it contains no analytics, no telemetry, no advertising, no
tracking, and no remote code.

## Data collection

None. The extension does not collect or store any personal information,
browsing history, or usage data. It has no backend server and no database.

## Data sharing

The extension does not share user data with any party. There are no third
parties involved. The only "transfer" that ever occurs is the one you
perform yourself: delivering a file you selected into the web page you
selected, in your own browser.

## Permissions

- `downloads`, `downloads.open` — list, open, and reveal your recent
  downloads in the popup.
- File URL access — read a downloaded file's contents only when you upload
  or drag it into a page. This additionally requires the user-controlled
  "Allow access to file URLs" toggle in Chrome.
- `scripting`, `activeTab` — deliver the file into the page you drop it on,
  only on the tab where you invoked the extension and only after you act.

## Changes to this policy

If a future version of the extension changes how data is handled, this
policy will be updated before that version is published, and the store
listing's data-usage disclosures will be updated to match.

## Contact

Questions about this policy: coolayush2017@gmail.com, or open an issue at
https://github.com/AyushBarik/persistent-downloads-button/issues
