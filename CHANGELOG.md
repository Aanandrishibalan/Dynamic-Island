# Changelog

## 1.4.1
- **Tools are readable.** The island's general form rule centred the tool forms and shrank every field to its text. The tools now use larger controls (42 px fields, 14.5 px text) that fill the width. Text expander, File renamer and QR codes use two columns; the renamer's Rename button and preview stay in view while you scroll.
- **Calculator:** larger keys, and the **=** key is visible again (the music-equalizer `.eq{display:none}` rule was hiding it).
- **Quick launch:** favourites are icon tiles; the add-an-app search list shows each app's icon and marks apps already pinned.
- **Find > All apps** is a grid of icon tiles with sharper 48 px icons. Microsoft Store apps now get their icon too (read from each app's manifest).
- **New: Task manager** slide (Home > Running apps). Apps tab (programs with a window) and Background tab, with icon, window title, memory and process count. Tick several rows or Select all, then **End selected** (asks first); each row also has **End** (asks "Sure?"). Apps are closed politely first; anything still open can be force-ended. Windows' own programs are locked, the island's helpers are never listed, and programs running as administrator are reported as refused.
- Tests added for process grouping, protection rules and the end/list handlers.

## 1.4.0
- **Network speed** slide: live download/upload with a one-minute graph, a speed test (ping, jitter, download, upload), connection details and history.
- Slides no longer stop between two pages (sideways scroll fixed).
- Installing a new build now shows the new build: the installer closes a running island, and a newer copy takes over from an older one. Version shown in Settings > About.

## 1.3.0
- **Tools:** clipboard history, text expander, window snapping and layouts, quick launch, file renamer with undo, phone-to-PC file transfer, screenshot OCR, calculator and converter, QR codes.

## Earlier
Smart assistant, planner, habits, goals, journal, expenses, Wi-Fi and Bluetooth, mail, wellness, installer and portable builds. See [docs/GUIDE.md](docs/GUIDE.md).
