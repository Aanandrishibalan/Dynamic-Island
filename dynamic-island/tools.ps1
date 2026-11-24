# Dynamic Island tools helper (local only).
# Long-running process started by the app (main.js): one command per line on stdin, one reply line on stdout.
# It does NOT use the network, download or run remote code, use encoded/obfuscated commands, or touch startup / registry settings.
#   winlist                  - visible top-level windows (Z-order) and the work area of each monitor
#   winbatch <json>          - move / resize / maximise windows: [{h,x,y,w,hh,max}]
#   winfocus <handle>        - bring a window to the front
#   ocr <json>               - text from an image file with the Windows built-in OCR (Windows.Media.Ocr, offline): {path,lang}
#   ocrlangs                 - OCR languages installed in Windows
#   sendpaste / typetext     - press Ctrl+V / type text in the window that is in front (used by "Paste" in the island)
#   clipexcl                 - 1 when the app that just copied asked not to be recorded (password managers do this)
#   proclist                 - every running process: pid, name, window title, memory (the Task manager slide)
#   procend <json>           - end programs the user ticked: {force, items:[{pid,name}]}. Only Stop-Process / CloseMainWindow; a pid whose name changed is left alone
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
[StructLayout(LayoutKind.Sequential)] public struct R4 { public int L, T, R, B; }
public class WinInfo { public long H; public string Title; public uint Pid; public int L, T, R, B; public bool Max, Min; }
public class Wm {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out R4 r);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr c);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out R4 v, int size);

  // Without this Windows scales the numbers for us and windows land in the wrong place on high-DPI screens.
  public static void DpiAware() {
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
    catch (Exception) { try { SetProcessDPIAware(); } catch (Exception) { } }
  }
  public static List<WinInfo> List() {
    List<WinInfo> res = new List<WinInfo>();
    EnumWindows(delegate (IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      if ((GetLong(h, -20) & 0x80) != 0) return true;                 // WS_EX_TOOLWINDOW (floating palettes, tray helpers)
      if (GetWindow(h, 4) != IntPtr.Zero) return true;                // owned windows (dialogs) follow their owner
      int cloaked = 0; DwmGetWindowAttribute(h, 14, out cloaked, 4);  // DWMWA_CLOAKED: hidden Store apps / other virtual desktops
      if (cloaked != 0) return true;
      int n = GetWindowTextLength(h); if (n <= 0) return true;
      StringBuilder sb = new StringBuilder(n + 1); GetWindowText(h, sb, n + 1);
      R4 r; if (!GetWindowRect(h, out r)) return true;
      WinInfo w = new WinInfo(); w.H = h.ToInt64(); w.Title = sb.ToString();
      uint pid; GetWindowThreadProcessId(h, out pid); w.Pid = pid;
      w.L = r.L; w.T = r.T; w.R = r.R; w.B = r.B; w.Min = IsIconic(h); w.Max = IsZoomed(h);
      res.Add(w); return true;
    }, IntPtr.Zero);
    return res;
  }
  // Rectangle the user sees (without the invisible resize border Windows 10/11 adds) so snapped windows touch exactly.
  public static bool Move(long handle, int x, int y, int w, int hh, bool max) {
    IntPtr h = new IntPtr(handle);
    if (!IsWindow(h)) return false;
    if (max) { ShowWindow(h, 3); return true; }
    if (IsIconic(h) || IsZoomed(h)) ShowWindow(h, 9);
    R4 r; if (!GetWindowRect(h, out r)) return false;
    int dl = 0, dt = 0, dr = 0, db = 0; R4 e;
    if (DwmGetWindowAttribute(h, 9, out e, 16) == 0) { dl = e.L - r.L; dt = e.T - r.T; dr = r.R - e.R; db = r.B - e.B; }
    return SetWindowPos(h, IntPtr.Zero, x - dl, y - dt, w + dl + dr, hh + dt + db, 0x0004 | 0x0010);   // SWP_NOZORDER | SWP_NOACTIVATE
  }
  public static void Focus(long handle) {
    IntPtr h = new IntPtr(handle);
    if (!IsWindow(h)) return;
    if (IsIconic(h)) ShowWindow(h, 9);
    keybd_event(0xA4, 0, 0, UIntPtr.Zero); keybd_event(0xA4, 0, 2, UIntPtr.Zero);   // a tap of Alt lets SetForegroundWindow through
    SetForegroundWindow(h);
  }
}
[StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr dwExtraInfo; }
[StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr dwExtraInfo; }
[StructLayout(LayoutKind.Explicit)] public struct INPUTU { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
[StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTU u; }
public class Kb {
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  static INPUT K(ushort vk, ushort scan, uint flags) { INPUT i = new INPUT(); i.type = 1; i.u.ki.wVk = vk; i.u.ki.wScan = scan; i.u.ki.dwFlags = flags; return i; }
  static void Send(List<INPUT> l) { if (l.Count > 0) SendInput((uint)l.Count, l.ToArray(), Marshal.SizeOf(typeof(INPUT))); }
  // Let go of Shift / Ctrl / Alt / Win if they are physically held, so Ctrl+V does not turn into Ctrl+Shift+V.
  public static void ReleaseModifiers() {
    List<INPUT> l = new List<INPUT>();
    int[] mods = new int[] { 0x10, 0x11, 0x12, 0x5B, 0x5C };
    foreach (int vk in mods) if ((GetAsyncKeyState(vk) & 0x8000) != 0) l.Add(K((ushort)vk, 0, 2));
    Send(l);
  }
  public static void CtrlV() { List<INPUT> l = new List<INPUT>(); l.Add(K(0x11, 0, 0)); l.Add(K(0x56, 0, 0)); l.Add(K(0x56, 0, 2)); l.Add(K(0x11, 0, 2)); Send(l); }
  public static void Backspaces(int n) { List<INPUT> l = new List<INPUT>(); for (int i = 0; i < n; i++) { l.Add(K(0x08, 0, 0)); l.Add(K(0x08, 0, 2)); } Send(l); }
  public static void Left(int n) { List<INPUT> l = new List<INPUT>(); for (int i = 0; i < n; i++) { l.Add(K(0x25, 0, 0)); l.Add(K(0x25, 0, 2)); } Send(l); }
  public static void TypeText(string s) {   // KEYEVENTF_UNICODE: works for any character, no clipboard involved
    List<INPUT> l = new List<INPUT>();
    foreach (char c in s) { l.Add(K(0, (ushort)c, 4)); l.Add(K(0, (ushort)c, 4 | 2)); }
    Send(l);
  }
}
public class Cb {
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern uint RegisterClipboardFormat(string n);
  [DllImport("user32.dll")] static extern bool IsClipboardFormatAvailable(uint f);
  // Password managers mark what they copy with these formats ("do not record me").
  public static bool Excluded() {
    return IsClipboardFormatAvailable(RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing")) || IsClipboardFormatAvailable(RegisterClipboardFormat("Clipboard Viewer Ignore"));
  }
}
"@
[Wm]::DpiAware()
Add-Type -AssemblyName System.Windows.Forms
$script:screens = [System.Windows.Forms.Screen]::AllScreens

# ---- WinRT (OCR) ----
$script:ocrReady = $false
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  [void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  [void][Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
  [void][Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  [void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  [void][Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics, ContentType = WindowsRuntime]
  [void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  [void][Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime]
  [void][Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
  $script:ocrReady = $true
} catch {}
function Await($op, $type) { $t = $script:asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
function Json($o) { ConvertTo-Json -InputObject $o -Compress -Depth 6 }
function Gone($p) { try { $null = Get-Process -Id $p.Id -ErrorAction Stop; $false } catch { $true } }   # HasExited can throw 'access denied' for other users' programs; asking again is safe

function Get-MonIndex($s) { for ($i = 0; $i -lt $script:screens.Length; $i++) { if ($script:screens[$i].DeviceName -eq $s.DeviceName) { return $i } }; return 0 }
$skipProc = @('electron', 'Dynamic Island', 'TextInputHost', 'SearchHost', 'StartMenuExperienceHost', 'ShellExperienceHost', 'LockApp')

function Get-Wins {
  $raw = [Wm]::List()
  $pids = @($raw | ForEach-Object { [int]$_.Pid } | Select-Object -Unique)
  $names = @{}
  if ($pids.Count -gt 0) { Get-Process -Id $pids -ErrorAction SilentlyContinue | ForEach-Object { $names[[int]$_.Id] = $_.ProcessName } }
  $out = @()
  foreach ($w in $raw) {
    $pn = [string]$names[[int]$w.Pid]
    if (-not $pn -or $skipProc -contains $pn) { continue }
    $title = $w.Title; if ($title.Length -gt 90) { $title = $title.Substring(0, 90) }
    $mon = 0
    if (-not $w.Min) {
      $rect = New-Object System.Drawing.Rectangle ($w.L, $w.T, [math]::Max(1, $w.R - $w.L), [math]::Max(1, $w.B - $w.T))
      $mon = Get-MonIndex ([System.Windows.Forms.Screen]::FromRectangle($rect))
    }
    $out += [pscustomobject]@{ h = [string]$w.H; title = $title; proc = $pn; x = $w.L; y = $w.T; w = ($w.R - $w.L); hh = ($w.B - $w.T); mon = $mon; max = [bool]$w.Max; min = [bool]$w.Min }
  }
  return $out
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $r = 'ERR'
  try {
    $sp = $line.IndexOf(' ')
    $cmd = if ($sp -lt 0) { $line } else { $line.Substring(0, $sp) }
    $arg = if ($sp -lt 0) { '' } else { $line.Substring($sp + 1) }
    switch ($cmd) {
      'winlist' {
        $mons = @(); for ($i = 0; $i -lt $script:screens.Length; $i++) {
          $a = $script:screens[$i].WorkingArea
          $mons += [pscustomobject]@{ i = $i; x = $a.X; y = $a.Y; w = $a.Width; h = $a.Height; primary = [bool]$script:screens[$i].Primary }
        }
        $r = Json ([ordered]@{ mons = @($mons); wins = @(Get-Wins) })
      }
      'winbatch' {
        $items = @(ConvertFrom-Json $arg)
        $okN = 0; $failN = 0
        foreach ($it in $items) {
          $good = $false
          try { $good = [Wm]::Move([long]$it.h, [int]$it.x, [int]$it.y, [int]$it.w, [int]$it.hh, [bool]$it.max) } catch {}
          if ($good) { $okN++ } else { $failN++ }
        }
        $r = Json ([ordered]@{ ok = $okN; fail = $failN })
      }
      'winfocus' { [Wm]::Focus([long]$arg); $r = 'ok' }
      'ocrlangs' {
        if (-not $script:ocrReady) { $r = Json ([ordered]@{ ok = $false; text = 'This version of Windows has no built-in OCR.'; langs = @() }) }
        else {
          $ls = @([Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | ForEach-Object { [pscustomobject]@{ tag = $_.LanguageTag; name = $_.DisplayName } })
          $r = Json ([ordered]@{ ok = $true; langs = $ls })
        }
      }
      'ocr' {
        $a = ConvertFrom-Json $arg
        $res = [ordered]@{ ok = $false; text = ''; lang = '' }
        if (-not $script:ocrReady) { $res.text = 'This version of Windows has no built-in OCR.' }
        elseif (-not (Test-Path -LiteralPath ([string]$a.path))) { $res.text = 'The image is gone.' }
        else {
          $engine = $null
          $tag = [string]$a.lang
          if ($tag -and $tag -ne 'auto') {
            try { $lg = New-Object Windows.Globalization.Language $tag; if ([Windows.Media.Ocr.OcrEngine]::IsLanguageSupported($lg)) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lg) } } catch {}
            if (-not $engine) { $res.note = 'The OCR language "' + $tag + '" is not installed in Windows; used your default languages instead.' }
          }
          if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }
          if (-not $engine) { $res.text = 'No OCR language is installed. Add one in Windows Settings > Time & language > Language & region (Optical character recognition).' }
          else {
            $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync([string]$a.path)) ([Windows.Storage.StorageFile])
            $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
            try {
              $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
              $bmp = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
              if ($bmp.PixelWidth -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension -or $bmp.PixelHeight -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension) { $res.text = 'The image is too large for Windows OCR.' }
              else {
                $o = Await ($engine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
                $lines = @($o.Lines | ForEach-Object { $_.Text })
                $res.ok = $true; $res.text = ($lines -join "`n"); $res.lang = [string]$engine.RecognizerLanguage.LanguageTag
              }
            } finally { if ($stream) { $stream.Dispose() } }
          }
        }
        $r = Json $res
      }
      'sendpaste' { [Kb]::ReleaseModifiers(); [Kb]::CtrlV(); $r = 'ok' }
      'typetext' { $a = ConvertFrom-Json $arg; [Kb]::ReleaseModifiers(); [Kb]::TypeText([string]$a.text); $r = 'ok' }
      'clipexcl' { $r = if ([Cb]::Excluded()) { '1' } else { '0' } }
      'proclist' {
        # One row per process; path + description only on the first row of each program (they are slow to read and identical).
        $rows = New-Object System.Collections.ArrayList; $seen = @{}
        foreach ($p in (Get-Process)) {
          if ($p.Id -le 4 -or $p.Id -eq $PID) { continue }
          $nm = [string]$p.ProcessName; $t = ''; $m = 0
          try { $t = [string]$p.MainWindowTitle } catch {}
          try { $m = [long]$p.WorkingSet64 } catch {}
          $row = [ordered]@{ pid = $p.Id; name = $nm; title = $t; mem = $m }
          if (-not $seen.ContainsKey($nm)) {
            $seen[$nm] = 1
            try { $row.path = [string]$p.Path } catch {}
            try { $row.desc = [string]$p.Description } catch {}
          }
          [void]$rows.Add([pscustomobject]$row)
        }
        $r = Json @($rows)
      }
      'procend' {
        $a = ConvertFrom-Json $arg
        $live = @(); $gone = @(); $denied = @()
        foreach ($it in @($a.items)) {
          $id = [int]$it.pid
          if ($id -le 4 -or $id -eq $PID) { continue }
          $p = $null
          try { $p = Get-Process -Id $id -ErrorAction Stop } catch { $gone += $id; continue }          # already closed
          if ($p.ProcessName -ne [string]$it.name) { $gone += $id; continue }                           # the number now belongs to another program: do not touch it
          $live += $p
        }
        foreach ($p in $live) {
          if ($a.force) { try { Stop-Process -Id $p.Id -Force -ErrorAction Stop } catch { $denied += $p.Id } }
          else { try { [void]$p.CloseMainWindow() } catch {} }                                           # polite close: the program may ask to save first
        }
        $until = (Get-Date).AddMilliseconds($(if ($a.force) { 1500 } else { 2500 }))
        do { Start-Sleep -Milliseconds 150; $left = @($live | Where-Object { -not (Gone $_) -and $denied -notcontains $_.Id }) } while ($left.Count -gt 0 -and (Get-Date) -lt $until)
        $still = @($live | Where-Object { -not (Gone $_) } | ForEach-Object { $_.Id })
        $closed = @($gone) + @($live | Where-Object { Gone $_ } | ForEach-Object { $_.Id })
        $r = Json ([ordered]@{ closed = @($closed); left = @($still | Where-Object { $denied -notcontains $_ }); denied = @($denied) })
      }
      'ping' { $r = 'pong' }
    }
  } catch { $r = 'ERR ' + ($_.Exception.Message -replace '[\r\n]+', ' ') }
  [Console]::Out.WriteLine($r); [Console]::Out.Flush()
}
