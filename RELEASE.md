# Windows Dynamic Island 1.4.2

A floating, always-on-top control centre for Windows 10 and 11, inspired by the iPhone Dynamic Island. Planner, smart assistant, music, search, network tools, a task manager and more, all in one swipeable pill at the top of your screen.

## Download

| File | Use it for |
| --- | --- |
| **Dynamic.Island-1.4.2-installer.exe** | Normal install. Choose a folder, get shortcuts and an uninstaller. Installs over an older version. |
| **Dynamic.Island-1.4.2-portable.exe** | No install. Data stays in a `DynamicIslandData` folder next to the file. |

Open or close the island with **Ctrl+Alt+Space**.

> **Windows SmartScreen:** these builds are not code-signed, so Windows may say "Windows protected your PC". Click **More info → Run anyway**.

## What's new in 1.4.2

- **Fixed: Assistant slide can now be moved.** It was missing from *Settings → Menus*, so it could not be dragged, reordered with ▲ ▼, or hidden. It is now listed first and works like every other slide.

- **Fixed: File transfer layout.** With two or more files chosen, the file list no longer overlaps the Start / Stop button and the QR code; it scrolls inside its own box.

## Highlights of the 1.4 series

- **Task manager:** see running apps with icons, tick any number and end them. Apps close politely first, and Windows' own programs are protected.
- **Network speed:** live download/upload graph and a speed test with history.
- **Readable tools:** larger controls, a visible **=** key on the calculator, icon tiles in Quick launch and Find → All apps (including Microsoft Store apps).
- **Smoother slides:** panels no longer stop half-way between two pages.
- **Reliable updates:** installing a new build now replaces the running one, so you always see the new version.

## Everything in the app

- **Home:** quick tiles, Speak / Vision / Chat, camera strip, customizable buttons
- **Daily productivity:** Planner, Habits, Daily goals, Journal, Expenses, Tasks & reminders, Calendar, Timer & stopwatch, Shopping list, Alarms and clocks, with Quick Capture (`Call supplier at 4 PM`)
- **Smart assistant:** daily briefing, voice commands, screen questions, scheduling, summaries, writing help, meeting notes, personal memory
- **Browse and find:** Music, Browser, Sticky pad, Find, Photos, Weather, News
- **System and network:** Wi-Fi & Bluetooth, Network speed, Health & usage, System, Style
- **Tools:** clipboard history, text expander, window layouts, quick launch, file renamer, phone-to-PC transfer, screenshot OCR, calculator and converter, QR codes
- **Messages:** Outlook, Gmail and WhatsApp
- **Security:** encrypted vault for keys, optional passphrase, sandboxed windows

## Upgrading

1. Run the new installer over the old version (or start the new portable exe).
2. If *Settings → About* still shows an older version, right-click the tray icon, choose **Quit**, and start the app again.

## Requirements

- Windows 10 or 11
- Optional: [Ollama](https://ollama.com) for local AI chat, whisper.cpp for voice (see the README)

## Privacy

Tasks, calendar, scheduling, search and voice commands stay on your PC. Only text you point at is sent to the AI model you choose, and every answer says which engine produced it. Meeting audio is never saved.

## Links

- [README](README.md) for the full feature list and shortcuts
- [Feature guide](docs/GUIDE.md)
- [CHANGELOG](CHANGELOG.md) for every version

**Full changelog:** see [CHANGELOG.md](CHANGELOG.md)
