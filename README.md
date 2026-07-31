# Persistent Download Button

Isn't it convenient to drag and drop files straight from the downloads
button? Isn't it convenient to open files fast from the downloads button?

But it's *not* convenient that the downloads button disappears after a while.

So here it is: **the world's first persistent downloads button!** A
Chrome extension whose toolbar button is always there: click it to see
your last 50 downloads, then open them, reveal them on disk, drag them out,
or drop them straight into websites.

## Features

- **Always-on popup** — click the toolbar icon on any tab to see your 50 most
  recent downloads with file icon, name, size, and age.
- **Click to open** — click any row to open the file; hover for a
  "show in folder" button.
- **Drag out** — drag a row onto your Desktop or into Finder/Explorer to copy
  the file there.
- **Drag into websites** — drag a row into an upload area (Claude, Gmail,
  Drive, forms) on the tab you opened the popup over, and the file uploads as
  if you'd dropped it from your desktop. The hover ⬆ button does the same
  into the current page with one click.
- **Refresh** — the ↻ button clears entries whose files were deleted from
  disk, so the list shows files that actually exist.

## Data usage

This extension collects no data. Everything happens locally on your device:
it reads your browser's download history to display the list, and reads a
downloaded file's contents only when you drag or upload it into a page —
solely to hand that file to the site you chose. Nothing is transmitted to the
developer or any external service, no analytics or tracking of any kind are
included, and no data is stored beyond your browser's own download history.
Its permissions are used only for the features above: `downloads` (list/open/
reveal files), file access (read the file being uploaded), and
`scripting`/`activeTab` (deliver the file into the page you drop it on, only
after you act).
