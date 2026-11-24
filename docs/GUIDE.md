# Windows Dynamic Island

Requires Windows 10/11 and Node.js 18+.

    npm install
    npm start        # run
    npm run dist     # build installer into /dist

Ctrl+Alt+Space opens/closes the island (changeable in Settings).

## Setup
Install Ollama, then once:  ollama pull llama3.2:1b   (default chat model)

## Settings (island > Settings)
General: theme (dark/light/match Windows), accent colour, 24h clock, start with Windows, shortcut.
AI & chat: model, Ollama address, system prompt, read replies aloud, save history.
Chat history: read, continue in the island, delete.
Tasks: add, complete, delete.

## Indicator colours (first match wins)
Blue listening, amber thinking, purple speaking, red offline, yellow low battery,
grey airplane, indigo focus, green online.

## Volume, brightness, apps
Handled by helper.ps1 (a persistent PowerShell process).
Volume: Windows Core Audio. Brightness: WMI, laptop/built-in displays only.
Apps: windows that are open now, newest first; click one to bring it to the front.

## Speak (Whisper)
Put whisper.cpp for Windows and a model file in the whisper/ folder (see whisper/README.txt).
Click Speak, talk, pause: the text is transcribed and sent to chat. Voice commands:
"open notepad", "lock the computer", "explain this screen".
Settings > AI & chat: model file and language (Auto, English, Tamil).

## Vision (screen questions)
Run: ollama pull gemma3:4b   (change the model in Settings). Click Vision, type a question:
the island hides itself from the capture, screenshots your main display and asks the model.
Chat model llama3.2:1b cannot read images, so a separate vision model is used.

## Slides (swipe, arrow keys, or click the dots under the panel)
Home, Music, Browser, Sticky pad, Find, Health & usage, System, Style.
- Music: now playing, previous / play-pause / next, volume (Windows media session).
- Browser: type a URL or a search; quick links come from Settings > General.
- Sticky pad: three notes, saved automatically.
- Find: installed-app search, open apps, file search (Windows Search index), recent files.
- Health: screen time, idle time, time per app (tracked while the island runs), battery level and drain.
- System: CPU, memory, storage, uptime.
- Style: theme, island size and colour, accent, status glow, link to all settings.

## Update: reminders, photos, weather, news
- Tasks & reminders slide (scrollable): add a task, optionally pick a time. When it is due the island expands, plays a chime and offers Done / Snooze 5 min / Dismiss. Tasks are no longer in the Settings window.
- Music shows only Spotify or Chrome sessions.
- Photos: your Pictures folder (change in Settings). Weather: Open-Meteo (set city in Settings, or auto-detected). News: RSS feed chosen in Settings.
- Touch or hover the dots to see the slide name; drag across them to scrub.

## Update: all apps, capture tools, messages

**Find > All apps** lists every installed app (desktop and Microsoft Store, via Get-StartApps plus Start Menu shortcuts), A-Z, searchable. Click to launch. "Open now" shows running windows.

**Home** now has Speak / Vision / Chat as icon buttons with an AI badge, and a sideways-scrollable strip: Photo, Live video, Record, Voice rec, Screenshot.
Files are saved to Pictures\Dynamic Island (photos, screenshots), Videos\Dynamic Island, Music\Dynamic Island\Voice notes
(change in Settings > General > Capture folder). Video and voice notes are .webm. The camera and microphone are only on while a capture screen is open.

**Messages** (Home > Outlook / Gmail / WhatsApp, or the Messages slide; set up in Settings > Messages). New arrivals expand the island and can also raise a Windows notification.
- Outlook: reads unread mail from the classic Outlook desktop app (must be open) through outlook.ps1. The "new Outlook" has no such interface and is not supported.
- Gmail: IMAP with a Google app password (needs 2-Step Verification). Stored in the encrypted vault (vault.dat), never sent to the UI.
- WhatsApp: runs WhatsApp Web in a background window (scan the QR once). Unread count and message text come from the notifications WhatsApp Web raises, so this depends on WhatsApp Web's behaviour.
The first check of each source is silent; only mail that arrives while the island runs triggers notifications.
Run `npm install` once (adds imapflow).

## Update: larger island, customizable Home
- The island is about 10% larger (Style > Size: Small / Medium / Large).
- Home scrolls. Tap "Customize" (top right of Home) to add, remove and reorder buttons, and to hide the weather/tasks/music row or the volume/brightness sliders. "Reset to default" restores the original layout.
- Focus now works: while it is on, message pop-ups, sounds and Windows notifications from Outlook, Gmail and WhatsApp are held back (messages still appear in the Messages slide and badges). Reminders still ring.

## Update: Wi-Fi & Bluetooth
- New slide "Wi-Fi & Bluetooth" (Home > Devices). Wi-Fi: on/off switch, connected network with Disconnect, nearby networks (signal, lock, Saved), tap to connect, password prompt for new secured networks (open, WPA2 and WPA3 personal), Forget for saved ones. Bluetooth: on/off switch and paired devices with connected / not connected.
- Windows does not let apps connect or disconnect a Bluetooth device; pair, connect and remove in Windows Settings (button in the slide).
- The Wi-Fi, Bluetooth and Airplane tiles on Home now really switch the radios (Airplane = all radios off). If Windows refuses, Settings opens instead.
- Windows 11 24H2 may need Location turned on for Wi-Fi scanning; the slide shows Windows' own message if the scan is empty.
- A typed Wi-Fi password is only used to create the Windows Wi-Fi profile (temporary file, deleted at once). The island never stores it.

## Update: timer, stopwatch, calendar, Claude / ChatGPT sign-in, wider island
- **Timer & stopwatch** (Home > Timer / Stopwatch, or the "Timer & stopwatch" slide). Timer: hours/minutes/seconds, presets (1, 5, 10, 15, 25 min, 1 hour), Start / Pause / Reset, a progress ring. When it ends the island expands with a chime and offers Done / Snooze 5 min (restarts a 5-minute timer) / Dismiss. Stopwatch: Start / Stop / Lap / Reset with best and worst laps highlighted. Both keep running while the island is collapsed: the collapsed island shows the running time (⏱ timer, ⏲ stopwatch) in place of the clock, and the state is saved, so a restart does not lose it. Voice: "set a timer for 10 minutes".
- **Calendar** (Home > Calendar, or the Calendar slide). Month grid with today and the selected day marked, a dot on days that have something, previous/next month and Today. The right side lists the day's events and tasks that have a reminder time. Add an event with an optional time: events with a time alert you like a reminder (Done / Snooze / Dismiss). Week start: Settings > General > Week starts on (Automatic, Sunday, Monday).
- **Claude and ChatGPT sign-in** (Settings > AI & chat). Paste an API key (Anthropic: console.anthropic.com/settings/keys, OpenAI: platform.openai.com/api-keys); the key is checked, stored in the encrypted vault and never shown again. Then pick the model and choose "Chat with" Local / Claude / ChatGPT. The first provider you connect is switched on automatically. Chat, voice questions and "explain this screen" then go to that provider. A claude.ai or chatgpt.com subscription login cannot be used by other apps, and API use is billed separately by Anthropic / OpenAI.
- **Wider island.** The expanded island is 600 px wide (was 450), notifications and reminders 600 px, the listening bar 400 px (was 320) and the collapsed pill 176 px (was 140). Home shows 5 buttons per row and Photos 6 thumbnails per row. The island window is 820 px wide so the Large size still fits.
- Home buttons: Calendar, Timer and Stopwatch are in the default layout. If you customised Home earlier, add them with Customize > Add buttons.


## Update: security, live pill, installer + portable
- **Encrypted vault** (vault.js): Claude / ChatGPT keys and the Gmail app password live in one file, vault.dat, encrypted with AES-256-GCM (fresh IV per save, tamper-checked). Old ai-keys.bin / secrets.bin are imported once, overwritten and deleted.
- **Settings > Security**: optional passphrase (scrypt N=65536). With it nothing can open the vault without the passphrase, it works on any PC (use it for the portable build), auto-locks after idle (default 30 min) and when Windows locks or sleeps, 3 wrong tries trigger a delay. Without one, the key is bound to your Windows account (DPAPI). Erase button overwrites the file. A forgotten passphrase cannot be recovered.
- **Hardening**: sandboxed windows, IPC only from the app's own pages, settings whitelist, no pop-ups or navigation away, camera/mic only for the island, "open file" refuses programs and scripts, single instance.
- **Live pill**: while music plays or a timer / stopwatch runs, the collapsed island widens into a live pill (artwork + scrolling title + equalizer; ring + countdown for timers). Click it to jump to Music or Timer. Style > Live activity turns it off.
- **Size**: the open island is now wider and shorter (680 x 440 instead of 600 x 540).
- **Wi-Fi list**: uses the Windows WLAN API for a fresh scan (netsh as fallback). On Windows 11 Location must be on for apps to list networks; the island shows a button to open that setting.

## Update: About tab
Settings > About now lists the features, every status-indicator colour and the keyboard shortcuts and gestures (the open shortcut shown is your current one).
It now covers every feature (Planner, Habits, Goals, Journal, Expenses, the Assistant, Tools, Security, tray and capture), a guide to each Settings tab, and your current Quick Capture, voice, OCR and open shortcuts.

Dropdown lists in Settings follow the theme (the options were hard to read in the dark theme before).

## Update: screenshot options
Home > Screenshot now opens a small menu instead of capturing at once:
- **Without island**: the island window is hidden while the picture is taken, so no part of it can appear.
- **Collapsed island**: the island shrinks to its small pill and the pill is included in the picture.
- **Wait before capture**: Now, 3, 5 or 10 seconds, to arrange the screen first (the island stays hidden / collapsed during the wait).
Your choice is remembered, and can also be set in Settings > General (Screenshot mode, Screenshot delay). Esc closes the menu. The island is always restored afterwards, even if the capture fails.

## Build (Windows)
Install Node.js 18+, then double-click build-windows.bat (or run `npm install` and `npm run dist`). Output in dist\:
- Dynamic Island-<version>-installer.exe - installer (choose folder, shortcuts, uninstaller)
- Dynamic Island-<version>-portable.exe - single file, no install; data is kept in a DynamicIslandData folder next to it
`npm run dist:installer` or `npm run dist:portable` build only one.

## Update: choose which menus (slides) show
Settings > **Menus** lists every slide with a checkbox (Music, Tasks, Calendar, Timer, Wi-Fi & Bluetooth, Browser, Sticky pad, Find, Photos, Weather, News, Health, System, Style, Messages). Untick one and it disappears at once from the swipe, the dots, the arrow keys and dot-scrubbing; Home buttons and the Weather / Tasks / Music chips that lead to a hidden slide are hidden too. Home is always shown. "Show all" and "Hide all except Home" are one click. Stored in the `hiddenSlides` setting.

## Update: custom menu order
Settings > Menus: drag a row by its handle (⠿) or use the ▲ ▼ arrows to set the order of the slides. The island's swipe, dots and arrow keys follow it at once. Home always stays first. "Reset order" restores the default. Hidden slides keep their place in the order for when you show them again. Stored in the `slideOrder` setting.

## Update: Wi-Fi list no longer stuck on "Scanning…"
Wi-Fi now has its own PowerShell helper, so a slow radio or Bluetooth call cannot block it, and a helper that is still starting gets extra time. If Windows does not answer, the slide shows a message (press Refresh) instead of "Scanning…" forever. Each scan is logged to `wifi-debug.log` in the app-data folder (%APPDATA%\windows-dynamic-island) with the time taken and what Windows returned.

## Update: offline detection, microphone, vision, Home, date and location
- **Offline:** the status now checks the real internet connection every 10 s (a small request to Windows' own connectivity-test address, msftconnecttest.com, from the background process), because Windows reports "online" on virtual adapters (WSL, Hyper-V, VPN) even when Wi-Fi is off. Turn it off in Settings > General > Check internet connection (then only Windows' own network flag is used). Offline shows after about 3-10 s.
- **Voice:** the pill shows an amber "Starting microphone…" until audio really arrives, then blue "Listening…". The microphone opens in raw mode (no echo cancellation / noise suppression / auto gain), which opens much faster on most PCs. Clicking while it is still opening cancels cleanly and releases the microphone.
- **Vision:** the model is told to answer with at most 4 concrete next steps and not to describe the screen or mention date, time, clock or taskbar. The Windows taskbar is also cropped out of the screenshot. "Explain this screen" now asks "What should I do next?".
- **Home > Customize:** Volume, Brightness, Weather, Tasks and Music can each be shown or hidden. The Music tile shows an animated equalizer and a blue outline while music plays (artist shown too).
- **Settings > General:** Date format (automatic, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, long) and Location (type a city or "Detect my location", approximate, from your IP address) used for the weather.

## Update: tray icon, start with Windows, hide in full screen
- **Tray icon** (notification area, next to the clock): click opens the island, right-click for Open / Hide or Show island / Settings / Start with Windows / Hide in full screen / Quit. On Windows 11 new icons start in the ^ overflow: drag it onto the taskbar, or turn it on in Settings > Personalization > Taskbar > Other system tray icons.
- **Start with Windows** is switched on once for existing installs and re-registered at every launch (installed or portable build; not with `npm start`). `helper-debug.log` records the registration. If it still does not start, check Task Manager > Startup apps: Windows keeps its own on/off switch there.
- **Hide in full screen** (Settings > General, on by default): while a full-screen app is in front (video in full screen, games, presentations) the island is hidden and comes back when full screen ends. The open shortcut still shows it. A video in a normal window is not hidden.

## Daily productivity

Five slides sit right after Home (hide or reorder them in Settings > Menus):

| Slide | What it does |
| --- | --- |
| Planner | Today's plan: overdue, today (with calendar events), upcoming, anytime, done. Category filters (Personal, Work, Shopping, Urgent), a progress bar, and an Eisenhower **Matrix** view. The star marks a task important and moves it between quadrants. |
| Habits | Tick a habit each day; streak and last-7-days dots. |
| Daily goals | A target that resets each day (for example 8 glasses of water). + and - buttons, streak. |
| Journal | Daily notes with a mood, a "+ Done today" button that pastes the tasks you finished, and ideas from Quick Capture. |
| Expenses | Amount + note, category guessed from the note (change it with the chips), totals for today, 7 days and the month. Currency symbol in Settings > General. |

### Quick Capture

Press **Control+Alt+N** (change it in Settings > General) or use the **Quick add** button on Home. The planner opens with the cursor ready. Type a sentence and press Enter:

- `Buy groceries tomorrow` -> task, tomorrow, Shopping
- `Call supplier at 4 PM` -> task, today 4 PM (tomorrow if 4 PM has passed), Work
- `Pay electricity bill on Monday` -> task, next Monday
- `Complete Excel report before 6 PM` -> deadline 6 PM, reminder at 5:30 PM, Work
- More: `urgent: ...`, `!!`, `someday`, `every Monday at 10am`, `daily`, `every weekday`, `monthly`, `25 Dec`, `5/12` (day/month), `on the 5th`, `in 30 minutes`, `tonight`, `next Friday`
- Smart reminders that wait for a condition: `... when I plug in`, `... when I'm online`, `... when I unlock`
- `idea: ...` saves to the Journal; `spent 250 on lunch` saves an expense

A live preview under the box shows the name, date, time, category and priority it understood before you press Enter.

Understanding the sentence happens on this PC with no network. Optionally (Settings > AI & chat > Planner) the selected Claude or ChatGPT model can refine the name, category and priority and fill a missing date or time; it never overrides a date or time you typed. That sends the captured text to that company, so it is off for the local model unless you choose "Also the local model", and can be turned off completely.

Repeating tasks: ticking one creates the next copy for its next day (never in the past; monthly on the 31st lands on the last day of shorter months).

Tests: `node tests/planner.test.js` (parsing, repeats, matrix, habits, goals, expenses), plus `tests/main.test.js` for the main process.


## Smart assistant (new)

Open the **Assistant** slide (Home > Assistant, right after Home), press the **voice shortcut** (Control+Alt+V, change it in Settings > Assistant), or use the Speak button. Type or say things in your own words.

| Feature | Try saying | How it works |
| --- | --- | --- |
| **AI daily briefing** | "Good morning", "daily briefing" | Built on this PC from your tasks, calendar events, reminders, habits, goals, spending and unread mail. Opens by itself on the first open of each day (Settings > Assistant). |
| **Voice productivity** | "What's pending today?", "Set a timer for 25 minutes", "Open Chrome", "Turn volume up", "Mark buy milk as done", "Postpone report to tomorrow at 10", "Log 2 glasses of water", "Turn off Bluetooth", "Focus on", "Take a screenshot", "Lock the computer" | Rules on this PC, so it is instant and works offline. Risky actions (sleep, quit, delete, moving many tasks) ask for a yes first. |
| **Screen assistant** | "What's on my screen?", "Explain this screen" | Screenshot to your selected vision model, which answers with short actions you can tap: add a task, copy a code/number, add a note, or follow numbered steps. |
| **Smart scheduling** | "Find time for my unfinished tasks", "Find time for the report, 45 minutes", "When am I free tomorrow?", "Schedule a meeting with Ravi" | Looks at your working hours, calendar events, timed tasks (a 4 PM call blocks 4:00-4:30), lunch and deadlines; urgent and overdue first. Shows the plan and applies it only when you tap Apply (each task then gets a reminder at its start). |
| **AI summarisation** | "Summarise the selected text", "Summarise my unread mail", "Summarise clipboard", "Summarise a document" (.txt .md .csv .json .html .docx) | Selected text is copied with Ctrl+C from the app you were in (never into a terminal, and your clipboard is put back). Falls back to a simple offline summary when no model answers. |
| **AI writing** | "Fix the grammar of the selected text", "Make this more formal", "Translate this to Tamil", "Write an email to the supplier asking to confirm delivery by Friday", "Reply saying I will be late" | Result appears with a Copy button. Uses your remembered preferences (e.g. sign-off) when sharing is allowed. |
| **Meeting assistant** | "Start meeting notes" ... "Stop the meeting" | Records in short pieces, transcribes each with Whisper / OpenAI, then writes a title, summary, decisions and action items. **Audio is never saved**; notes are kept only if you tap Save (Settings > Assistant lists, exports as Markdown, deletes). Action items can be added to the planner in one tap. |
| **Natural language search** | "Find my budget spreadsheet from last week", "What did I note about kuli?", "How much did I spend on food this month?", "Where is the invoice pdf?" | Searches tasks, events, sticky notes, journal, meetings, expenses, chats and memory, plus Windows Search for files and the installed-app list. |
| **Contextual suggestions** | (automatic) | A hint on Home and in the Assistant: in Teams/Zoom -> meeting notes; in Outlook -> summarise mail; in Word -> proofread; event in 15 min; overdue tasks; evening wrap-up; low battery; long screen time; routines you approved. Dismiss with the x. |
| **Personal memory** | "Remember that I work 10 to 7", "Remember that I prefer short meetings", "What do you remember?", "Forget the gym" | Saved only after you say so or tap **Remember this** on a proposal ("I usually go to the gym at 6 PM" -> "Want me to remember that?"). Work hours and lunch change scheduling; routines become suggestions. View, delete or clear in Settings > Assistant. |

### Privacy
- Tasks, calendar, scheduling, search, briefings and voice commands never leave this PC.
- Only text you point at (a selection, clipboard, a file, a meeting transcript, a screenshot) goes to the model chosen in Settings > AI & chat. Every answer says which engine produced it ("via Claude", "via local model", "on this PC", "offline").
- Tasks, calendar and memory are added to a chat prompt only with the local model, or when you switch on "Share tasks, calendar and memory with Claude / ChatGPT" (off by default).
- Windows only: selection capture and app/file control use `helper.ps1` (two new commands: `copysel`, and the foreground-window handle in `fg`).

### Tests
`node tests/assistant.test.js` (logic, voice router, privacy, token and validation rules), `tests/main.test.js` (IPC), and `node tests/ui.smoke.js` (headless Chromium check of the real UI; needs Playwright).

## Tools (new in 1.3)
Nine extra slides (Settings > Menus to hide or reorder, Settings > Tools for options):
Clipboard history (text only, local), Text expander (off until switched on; uses a keyboard helper, expander.ps1),
Windows (snap, layouts), Quick launch (favourite apps + folders), File renamer (preview + undo),
File transfer (phone <-> PC over your Wi-Fi), Screenshot OCR (Ctrl+Alt+O, Windows built-in OCR, offline),
Calculator + converter (currency rates from open.er-api.com), QR codes.
Helper scripts tools.ps1 and expander.ps1 run from the install folder (resources when packaged).

## Update 1.4.0: Network speed, smoother slides, reliable updates
- **Network speed slide** (Home > Speed, or the "Network speed" slide right after Wi-Fi & Bluetooth; hide or reorder it in Settings > Menus). It scrolls vertically:
  live download / upload speed with a one-minute graph (read from the real adapters' byte counters, once a second, only while the slide is open); a **speed test** (ping, jitter, download, upload, a progress bar and a Stop button, using Cloudflare's public speed servers) with a plain-words verdict; connection details (network, link speed, local IP, test server, public IP); and a history of your last tests (kept on this PC, Clear button). The test uses roughly 50-150 MB of data on a fast line. If a firewall or proxy blocks speed.cloudflare.com the slide says so instead of waiting forever.
- **Slides no longer stop between two pages.** The panel could end up scrolled a few pixels sideways (focusing a field, a drag that selected text, touch), which left one slide cut off at the left and the next one peeking in on the right. The panel, the island and every slide are now clipped instead of hidden (they cannot be scrolled sideways at all), anything that still moves is snapped back, and a window resize re-aligns the current slide.
- **Installing a new build now shows the new build.** Before, the old island kept running and the new one only woke it up (single-instance lock), so the screen still showed the old version. Now: (1) the installer closes a running island before copying files; (2) a newly started copy that is newer than the running one stops it and takes over (the running version is tracked in `running.json` in the app-data folder); (3) a copy that is the same or older just opens the running island. The first launch after an update shows a Windows notification ("Now running version X (was Y)"). The version is shown in **Settings > About** and in the tray icon tooltip. The tray icon file (`build/icon.ico`) is now packaged too.
- Customised Home layouts get the new Speed button once (next to Devices); you can remove it in Customize.
- Tests: `node tests/speed.test.js`, plus `node tests/ui.speed.js [screenshot-dir]` (headless Chromium; needs Playwright) for the slide, the live graph and the sideways-scroll fix.
- Updating from an older build: install over it (or run the new portable exe). If anything still shows the old version, quit the island from the tray icon (right-click > Quit) or end "Dynamic Island" in Task Manager once, then start the new one. Settings > About shows which version is running.

## Update 1.4.1: bigger tools, Task manager, app icons
- **Tools are readable again.** The island's general `.slide .frm` rule centred the tool forms and shrank every field to its text; the tools now use their own larger controls (42 px fields, 14.5 px text) that fill the width. Text expander, File renamer and QR codes use two columns (form on the left, list / preview / code on the right); the renamer's Rename button and preview stay in view while you scroll the options.
- **Calculator** is larger, and the **=** key is back (the island's music-equalizer `.eq{display:none}` rule was hiding it).
- **Quick launch** shows favourites as icon tiles and the add-an-app search list shows every app's icon (already pinned apps say "Added").
- **Find > All apps** is a grid of icon tiles. Microsoft Store apps now get their icon too (read from the app's own manifest by `helper.ps1 applogos`); icons are 48 px instead of 16 px.
- **Task manager** (new slide after QR codes; Home > Running apps; hide or reorder in Settings > Menus).
  - **Apps** tab: programs with a window, with icon, window title, process count and memory. **Background** tab: everything else.
  - Tick any number of rows (or Select all) and press **End selected**, which asks "Yes, end N apps" first. Each row also has its own **End**, which asks "Sure?".
  - Apps are closed politely first (the program may ask to save). Anything still open is reported and a **Force end** button appears. Background processes have no window to close, so they are ended directly.
  - Safety: Windows itself (Explorer, services, Defender, ...) shows a lock and cannot be ended; the island and its helpers are never listed; the page only sends back ids from the last list, and the helper refuses a pid whose program name changed. Programs running as administrator cannot be ended from the island and the slide says so.
  - The list refreshes every 4 s while the slide is open on screen.
  - Store (UWP) apps are hosted by Windows, so they appear under Background rather than Apps.
- Tests: new cases in `tests/tools.test.js` and `tests/toolsmain.test.js`.
