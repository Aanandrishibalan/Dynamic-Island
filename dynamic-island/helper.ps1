# Dynamic Island helper (local only).
# Long-running process started by the app (main.js). It reads one command per line from stdin and
# writes one reply line to stdout. It does NOT use the network, download or run remote code, use
# encoded/obfuscated commands, or change startup/registry settings. Commands:
#   get / setvol / setbright  - master volume (Core Audio) and built-in display brightness (WMI)
#   apps / focus              - list open windows, bring one to the front
#   allapps                   - every installed app (Get-StartApps: desktop + Store apps)
#   applogos                  - {AppUserModelID: path of the app's own logo .png} for Microsoft Store apps (read from each package's AppxManifest.xml)
#   fg                        - idle time + foreground app name (Health & usage slide)
#   media                     - now-playing info and play/pause/next/prev (Spotify, Chrome)
#   files                     - filename search through the Windows Search index
#   radios / radio / airplane - Wi-Fi and Bluetooth radios on/off (Windows.Devices.Radios, the same API as Settings)
#   wifi / wificonnect / wifidisc / wififorget - nearby networks, connect, disconnect, forget (netsh wlan)
#   btlist                    - paired Bluetooth devices and whether they are connected (Windows.Devices.Bluetooth)
# Wi-Fi passwords typed in the island are only used to create the Windows Wi-Fi profile for that network (a temporary
# XML file that is deleted straight away); they are never stored by the island and never leave this PC.
# Long-running helper: one command per line on stdin, one reply line on stdout.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int _0(); int _1(); int _2(); int _3();
  int SetMasterVolumeLevelScalar(float level, Guid ctx);
  int _5();
  int GetMasterVolumeLevelScalar(out float level);
  int _7(); int _8(); int _9(); int _10();
  int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid ctx);
  int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid iid, int ctx, IntPtr p, out IAudioEndpointVolume v); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int _0(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom {}
public class Vol {
  static IAudioEndpointVolume Ep() {
    var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
    IMMDevice d; en.GetDefaultAudioEndpoint(0, 1, out d);
    Guid iid = typeof(IAudioEndpointVolume).GUID; IAudioEndpointVolume v;
    d.Activate(ref iid, 23, IntPtr.Zero, out v); return v;
  }
  public static float Level { get { float f; Ep().GetMasterVolumeLevelScalar(out f); return f; } set { Ep().SetMasterVolumeLevelScalar(value, Guid.Empty); } }
  public static bool Mute { get { bool m; Ep().GetMute(out m); return m; } set { Ep().SetMute(value, Guid.Empty); } }
}
[StructLayout(LayoutKind.Sequential)] public struct LII { public uint cb; public uint t; }
[StructLayout(LayoutKind.Sequential)] public struct RC { public int L, T, R, B; }
[StructLayout(LayoutKind.Sequential)] public struct MI { public int cb; public RC mon, work; public uint flags; }
public class Win {
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int c);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LII p);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static void Focus(IntPtr h) { if (IsIconic(h)) ShowWindowAsync(h, 9); SetForegroundWindow(h); }
  public static uint IdleMs() { var l = new LII(); l.cb = (uint)Marshal.SizeOf(l); GetLastInputInfo(ref l); return (uint)Environment.TickCount - l.t; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RC r);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint f);
  [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MI i);
  [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
  [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")] static extern int GetWinLong(IntPtr h, int i);
  [DllImport("shell32.dll")] static extern int SHQueryUserNotificationState(out int s);
  // Is a full-screen app (video, game, presentation) in front? Windows' own "busy / D3D full screen / presentation" state,
  // plus a fallback: the foreground window has no title bar and covers its whole monitor (browser full-screen video).
  public static bool FullScreen() {
    int s; if (SHQueryUserNotificationState(out s) == 0 && (s == 2 || s == 3 || s == 4)) return true;
    IntPtr h = GetForegroundWindow();
    if (h == IntPtr.Zero || h == GetDesktopWindow() || h == GetShellWindow()) return false;
    if ((GetWinLong(h, -16) & 0xC00000) != 0) return false;   // WS_CAPTION: a normal window, even if maximised
    RC r; if (!GetWindowRect(h, out r)) return false;
    MI mi = new MI(); mi.cb = Marshal.SizeOf(mi);
    if (!GetMonitorInfo(MonitorFromWindow(h, 2), ref mi)) return false;
    return r.L <= mi.mon.L && r.T <= mi.mon.T && r.R >= mi.mon.R && r.B >= mi.mon.B;
  }
  public static uint FgPid() { uint p; GetWindowThreadProcessId(GetForegroundWindow(), out p); return p; }
  public static long FgHandle() { return GetForegroundWindow().ToInt64(); }
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  // Ctrl+C into whatever window is in front (used only when the user asks for the selected text; never sent to a terminal)
  public static void CopyKeys() { keybd_event(0x11, 0, 0, UIntPtr.Zero); keybd_event(0x43, 0, 0, UIntPtr.Zero); keybd_event(0x43, 0, 2, UIntPtr.Zero); keybd_event(0x11, 0, 2, UIntPtr.Zero); }
}
"@


# --- Native Wi-Fi scan (wlanapi.dll): forces a fresh scan and returns exact SSIDs (netsh only shows a stale cache) ---
$script:wlanOk = $false
try {
  Add-Type -TypeDefinition @"
using System; using System.Collections.Generic; using System.Runtime.InteropServices;
public class WlanNet {
  [DllImport("wlanapi.dll")] static extern int WlanOpenHandle(uint ver, IntPtr res, out uint neg, out IntPtr h);
  [DllImport("wlanapi.dll")] static extern int WlanCloseHandle(IntPtr h, IntPtr res);
  [DllImport("wlanapi.dll")] static extern int WlanEnumInterfaces(IntPtr h, IntPtr res, out IntPtr list);
  [DllImport("wlanapi.dll")] static extern int WlanScan(IntPtr h, ref Guid g, IntPtr ssid, IntPtr ie, IntPtr res);
  [DllImport("wlanapi.dll")] static extern int WlanGetAvailableNetworkList(IntPtr h, ref Guid g, uint flags, IntPtr res, out IntPtr list);
  [DllImport("wlanapi.dll")] static extern void WlanFreeMemory(IntPtr p);
  // rows: base64(ssid bytes) TAB signal(0-100) TAB secure TAB authAlgo TAB flags (1 = connected, 2 = has profile); or NOIFACE / ERR:code
  public static List<string> Run(int waitMs) {
    var res = new List<string>(); IntPtr h; uint neg;
    int rc = WlanOpenHandle(2, IntPtr.Zero, out neg, out h);
    if (rc != 0) { res.Add("ERR:" + rc); return res; }
    try {
      IntPtr il; rc = WlanEnumInterfaces(h, IntPtr.Zero, out il);
      if (rc != 0) { res.Add("ERR:" + rc); return res; }
      var guids = new List<Guid>();
      try {
        int n = Marshal.ReadInt32(il, 0);
        for (int i = 0; i < n; i++) { byte[] gb = new byte[16]; Marshal.Copy(IntPtr.Add(il, 8 + i * 532), gb, 0, 16); guids.Add(new Guid(gb)); }
      } finally { WlanFreeMemory(il); }
      if (guids.Count == 0) { res.Add("NOIFACE"); return res; }
      foreach (var g in guids) { Guid gg = g; WlanScan(h, ref gg, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero); }
      System.Threading.Thread.Sleep(waitMs);
      foreach (var g in guids) {
        Guid gg = g; IntPtr nl;
        if (WlanGetAvailableNetworkList(h, ref gg, 0, IntPtr.Zero, out nl) != 0) continue;
        try {
          int n = Marshal.ReadInt32(nl, 0);
          for (int i = 0; i < n; i++) {
            IntPtr p = IntPtr.Add(nl, 8 + i * 628);          // WLAN_AVAILABLE_NETWORK is 628 bytes
            int len = Marshal.ReadInt32(p, 512); if (len < 0 || len > 32) len = 0;
            byte[] sb = new byte[len]; if (len > 0) Marshal.Copy(IntPtr.Add(p, 516), sb, 0, len);
            res.Add(Convert.ToBase64String(sb) + "\t" + Marshal.ReadInt32(p, 604) + "\t" + Marshal.ReadInt32(p, 608) + "\t" + Marshal.ReadInt32(p, 612) + "\t" + Marshal.ReadInt32(p, 620));
          }
        } finally { WlanFreeMemory(nl); }
      }
    } finally { WlanCloseHandle(h, IntPtr.Zero); }
    return res;
  }
}
"@
  $script:wlanOk = $true
} catch {}

# --- Windows media session (now playing) ---
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $script:asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
} catch {}
function Await($op, $type) { $t = $script:asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
function Get-Session {
  try {
    [void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
    $m = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $all = @($m.GetSessions() | Where-Object { $_.SourceAppUserModelId -match 'spotify|chrome' })
    $pl = $all | Where-Object { $_.GetPlaybackInfo().PlaybackStatus -eq 'Playing' } | Select-Object -First 1
    if ($pl) { return $pl }
    return ($all | Select-Object -First 1)
  } catch { return $null }
}

# --- Radios + Bluetooth devices (WinRT) ---
$script:winrt = $false
try {
  [void][Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
  [void][Windows.Devices.Radios.RadioAccessStatus, Windows.System.Devices, ContentType = WindowsRuntime]
  [void][Windows.Devices.Radios.RadioState, Windows.System.Devices, ContentType = WindowsRuntime]
  [void][Windows.Devices.Enumeration.DeviceInformation, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
  [void][Windows.Devices.Enumeration.DeviceInformationCollection, Windows.Devices.Enumeration, ContentType = WindowsRuntime]
  [void][Windows.Devices.Bluetooth.BluetoothDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
  [void][Windows.Devices.Bluetooth.BluetoothLEDevice, Windows.Devices.Bluetooth, ContentType = WindowsRuntime]
  $script:winrt = $true
} catch {}
function Get-RadioAccess { [string](Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])) }
function Get-Radios { @(Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])) }
function Set-Radios($kinds, $on) {
  if ((Get-RadioAccess) -ne 'Allowed') { return 'denied' }
  $st = if ($on) { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }
  $res = 'ok'
  foreach ($x in (Get-Radios)) {
    if ($kinds -contains [string]$x.Kind) {
      $a = [string](Await ($x.SetStateAsync($st)) ([Windows.Devices.Radios.RadioAccessStatus]))
      if ($a -ne 'Allowed') { $res = 'denied' }
    }
  }
  return $res
}

# --- Wi-Fi through netsh (output is parsed by position and by "NN%" so it also works on most non-English Windows) ---
function Netsh {
  $ErrorActionPreference = 'Continue'
  $o = @(& netsh @args 2>&1 | ForEach-Object { [string]$_ })
  $script:nsExit = $LASTEXITCODE
  return $o
}
function Get-SavedWifi {
  $o = @()
  foreach ($l in (Netsh wlan show profiles)) { if ($l -match '^\s+[^:]+:\s(.+?)\s*$' -and $l -notmatch '<None>') { $o += $Matches[1] } }
  return $o
}
function Get-WifiNow {
  $ssid = $null; $sig = 0
  foreach ($l in (Netsh wlan show interfaces)) {
    if ($l -match '^\s*SSID\s*:\s*(.+?)\s*$') { $ssid = $Matches[1] }
    elseif ($ssid -and $l -match ':\s*(\d+)\s*%\s*$') { $sig = [int]$Matches[1] }
  }
  if ($ssid) { return [pscustomobject]@{ ssid = $ssid; signal = $sig } }
  return $null
}
function Get-WifiNative {
  $out = [pscustomobject]@{ state = 'off'; nets = @(); connected = $null }
  if (-not $script:wlanOk) { return $out }
  try {
    $rows = @([WlanNet]::Run(2200))
    if ($rows.Count -ge 1 -and ([string]$rows[0]) -eq 'NOIFACE') { $out.state = 'noiface'; return $out }
    if ($rows.Count -ge 1 -and ([string]$rows[0]).StartsWith('ERR')) { $out.state = 'err'; return $out }
    $out.state = 'ok'
    $names = @{ 1 = 'Open'; 2 = 'Shared'; 3 = 'WPA-Enterprise'; 4 = 'WPA-Personal'; 6 = 'WPA2-Enterprise'; 7 = 'WPA2-Personal'; 8 = 'WPA3-Enterprise'; 9 = 'WPA3-Personal'; 10 = 'Enhanced Open'; 11 = 'WPA3-Enterprise' }
    $by = [ordered]@{}
    foreach ($row in $rows) {
      $f = ([string]$row).Split("`t"); if ($f.Count -lt 5) { continue }
      $ssid = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($f[0])); if (-not $ssid) { continue }   # hidden networks have no name
      $sig = [int]$f[1]; $sec = [int]$f[2]; $au = [int]$f[3]; $fl = [int]$f[4]
      $auth = if ($names.ContainsKey($au)) { $names[$au] } else { 'Secured' }
      if ($fl -band 1) { $out.connected = [pscustomobject]@{ ssid = $ssid; signal = $sig } }
      if ($by.Contains($ssid)) {
        $e = $by[$ssid]; if ($sig -gt $e.signal) { $e.signal = $sig }; if ($fl -band 2) { $e.saved = $true }
      } else {
        $by[$ssid] = [pscustomobject]@{ ssid = $ssid; signal = $sig; auth = $auth; secure = (($sec -ne 0) -and ($au -ne 1)); saved = [bool]($fl -band 2) }
      }
    }
    $out.nets = @($by.Values)
  } catch { $out.state = 'err'; $out.nets = @() }
  return $out
}
function Get-WifiNetsh($saved) {   # fallback: parse "netsh wlan show networks mode=bssid"
  $nets = [ordered]@{}; $e = $null; $k = 0; $seenB = $false; $first = ''
  foreach ($l in (Netsh wlan show networks mode=bssid)) {
    if (-not $first -and $l.Trim()) { $first = $l.Trim() }
    if ($l -match '^SSID\s+\d+\s*:\s*(.*?)\s*$') {
      $n = $Matches[1]; $k = 0; $seenB = $false
      if ($n) {
        if (-not $nets.Contains($n)) { $nets[$n] = [pscustomobject]@{ ssid = $n; signal = 0; auth = ''; enc = '' } }
        $e = $nets[$n]
      } else { $e = $null }
    }
    elseif ($e) {
      if ($l -match '^\s+BSSID\s+\d+\s*:') { $seenB = $true }
      elseif (-not $seenB -and $l -match '^\s+[^:]+:\s*(.*?)\s*$') {
        $k++
        if ($k -eq 2 -and -not $e.auth) { $e.auth = $Matches[1] }
        if ($k -eq 3 -and -not $e.enc) { $e.enc = $Matches[1] }
      }
      elseif ($seenB -and $l -match ':\s*(\d+)\s*%\s*$') { if ([int]$Matches[1] -gt $e.signal) { $e.signal = [int]$Matches[1] } }
    }
  }
  $list = @($nets.Values | ForEach-Object {
    [pscustomobject]@{ ssid = $_.ssid; signal = $_.signal; auth = $_.auth
      secure = -not ($_.auth -match '^Open' -or $_.enc -match '^None')
      saved = [bool]($saved -contains $_.ssid) }
  })
  return [pscustomobject]@{ nets = $list; first = $first }
}
function XmlEsc($s) { [Security.SecurityElement]::Escape([string]$s) }

while ($null -ne ($line = [Console]::In.ReadLine())) {
  $r = 'ERR'
  try {
    $p = $line.Split(' ')
    switch ($p[0]) {
      'get' {
        $b = -1
        try { $b = [int](Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness | Select-Object -First 1).CurrentBrightness } catch {}
        $r = "$([int][math]::Round([Vol]::Level * 100)),$([int][Vol]::Mute),$b"
      }
      'setvol' {
        $v = [math]::Max(0, [math]::Min(100, [double]$p[1]))
        [Vol]::Level = [single]($v / 100)
        if ($v -gt 0) { [Vol]::Mute = $false }
        $r = 'ok'
      }
      'setbright' {
        $v = [byte][math]::Max(0, [math]::Min(100, [double]$p[1]))
        Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods |
          Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = $v } | Out-Null
        $r = 'ok'
      }
      'apps' {
        $a = @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -ne '' -and
            $_.ProcessName -notin @('electron', 'Dynamic Island', 'TextInputHost', 'SearchHost') } |
          ForEach-Object {
            $t = 0; $pa = ''
            try { $t = $_.StartTime.Ticks; $pa = $_.Path } catch {}
            [pscustomobject]@{ id = $_.Id; name = $_.ProcessName; title = $_.MainWindowTitle; path = $pa; t = $t }
          } | Sort-Object t -Descending | Select-Object -First 12)
        $r = ConvertTo-Json -InputObject $a -Compress
      }
      'allapps' {
        # Every app Windows lists in the Start menu: classic desktop apps and Microsoft Store (UWP) apps.
        $a = @(Get-StartApps | Sort-Object Name | ForEach-Object { [pscustomobject]@{ name = $_.Name; id = $_.AppID } })
        $r = ConvertTo-Json -InputObject $a -Compress
      }
      'applogos' {
        # Store apps have no .lnk to take an icon from, so read the logo the app declares in its own manifest and pick the best-sized file.
        $map = [ordered]@{}
        foreach ($pk in @(Get-AppxPackage -ErrorAction SilentlyContinue)) {
          try {
            $root = [string]$pk.InstallLocation
            if (-not $root) { continue }
            $mf = Join-Path $root 'AppxManifest.xml'
            if (-not (Test-Path -LiteralPath $mf)) { continue }
            $x = [xml](Get-Content -LiteralPath $mf -Raw -ErrorAction Stop)
            foreach ($ap in @($x.Package.Applications.Application)) {
              $ve = $ap.VisualElements
              if (-not $ve -or -not $ap.Id) { continue }
              $rel = [string]$ve.Square44x44Logo; if (-not $rel) { $rel = [string]$ve.Square150x150Logo }; if (-not $rel) { continue }
              $full = Join-Path $root $rel
              $dir = Split-Path -Parent $full; $base = [IO.Path]::GetFileNameWithoutExtension($full)
              if (-not (Test-Path -LiteralPath $dir)) { continue }
              $c = @(Get-ChildItem -LiteralPath $dir -Filter ($base + '*.png') -ErrorAction SilentlyContinue)
              if ($c.Count -eq 0) { continue }
              $best = $c | Sort-Object @{ Expression = { if ($_.Name -match 'targetsize-(\d+)' -and $_.Name -notmatch 'altform') { [int]$Matches[1] } else { 0 } }; Descending = $true },
                                       @{ Expression = { if ($_.Name -match 'scale-(\d+)') { [int]$Matches[1] } else { 0 } }; Descending = $true } | Select-Object -First 1
              $map[($pk.PackageFamilyName + '!' + $ap.Id)] = $best.FullName
            }
          } catch {}
        }
        $r = ConvertTo-Json -InputObject $map -Compress
      }
      'fs' { $r = if ([Win]::FullScreen()) { '1' } else { '0' } }
      'fg' {
        $n = ''
        try { $n = (Get-Process -Id ([int][Win]::FgPid())).ProcessName } catch {}
        $r = "$([int]([Win]::IdleMs() / 1000))|$n|$([Win]::FgHandle())"
      }
      'copysel' {
        $h = [int64]$p[1]
        if ($h -ne 0) { [Win]::Focus([IntPtr]$h); Start-Sleep -Milliseconds 150 }
        [Win]::CopyKeys(); Start-Sleep -Milliseconds 250
        $r = 'ok'
      }
      'media' {
        $s = Get-Session
        $act = if ($p.Count -gt 1) { $p[1] } else { 'info' }
        if ($act -eq 'info') {
          if (-not $s) { $r = 'none' } else {
            $mp = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
            $r = "$($s.GetPlaybackInfo().PlaybackStatus)|$($mp.Title)|$($mp.Artist)|$($s.SourceAppUserModelId)"
          }
        } else {
          if ($s) {
            switch ($act) {
              'toggle' { [void]$s.TryTogglePlayPauseAsync() }
              'next'   { [void]$s.TrySkipNextAsync() }
              'prev'   { [void]$s.TrySkipPreviousAsync() }
            }
          }
          $r = 'ok'
        }
      }
      'files' {
        $q = $line.Substring(6) -replace "['%\[\]_]", ''
        $c = New-Object -ComObject ADODB.Connection
        $c.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
        $rs = $c.Execute("SELECT TOP 15 System.ItemPathDisplay FROM SystemIndex WHERE System.FileName LIKE '%$q%' ORDER BY System.DateModified DESC")
        $out = @()
        while (-not $rs.EOF) { $out += [string]$rs.Fields.Item(0).Value; $rs.MoveNext() }
        $c.Close()
        $r = ConvertTo-Json -InputObject $out -Compress
      }
      'radios' {
        $o = @{ wifi = $null; bluetooth = $null }
        foreach ($x in (Get-Radios)) {
          $on = ([string]$x.State -eq 'On')
          if ([string]$x.Kind -eq 'WiFi') { $o.wifi = ($o.wifi -eq $true) -or $on }
          elseif ([string]$x.Kind -eq 'Bluetooth') { $o.bluetooth = ($o.bluetooth -eq $true) -or $on }
        }
        $r = ConvertTo-Json -InputObject $o -Compress
      }
      'radio' {
        $kind = if ($p[1] -eq 'wifi') { 'WiFi' } else { 'Bluetooth' }
        $r = Set-Radios @($kind) ($p[2] -eq 'on')
      }
      'airplane' {
        # Airplane mode on = every radio off, off = every radio back on (the same radios Windows' own switch controls)
        $r = Set-Radios @('WiFi', 'Bluetooth', 'MobileBroadband', 'FM') ($p[1] -eq 'off')
      }
      'netio' {
        # Byte counters of the real (physical) adapters, for the live speed on the Network speed slide. Virtual / VPN / Bluetooth adapters are skipped so traffic is not counted twice.
        $rx = [double]0; $tx = [double]0; $best = $null
        foreach ($n in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
          try {
            if ($n.OperationalStatus -ne 'Up') { continue }
            $nt = [string]$n.NetworkInterfaceType
            if ($nt -eq 'Loopback' -or $nt -eq 'Tunnel') { continue }
            if ($n.Description -match 'Virtual|vEthernet|Hyper-V|VMware|VirtualBox|Loopback|Pseudo|WSL|TAP-|Bluetooth|VPN|Miniport') { continue }
            $st = $n.GetIPStatistics()
            $rx += [double]$st.BytesReceived; $tx += [double]$st.BytesSent
            if (-not $best -or [double]$st.BytesReceived -gt $best.rxb) {
              $best = @{ name = [string]$n.Name; type = $(if ($nt -match 'Wireless') { 'Wi-Fi' } elseif ($nt -match 'Ethernet') { 'Ethernet' } else { $nt }); link = [math]::Round([double]$n.Speed / 1e6); rxb = [double]$st.BytesReceived }
            }
          } catch {}
        }
        if (-not $best) { $best = @{ name = ''; type = ''; link = 0; rxb = 0 } }
        $r = ConvertTo-Json -InputObject @{ rx = $rx; tx = $tx; name = $best.name; type = $best.type; link = $best.link } -Compress
      }
      'wifi' {
        $cur = Get-WifiNow
        $saved = @(Get-SavedWifi)
        $nat = Get-WifiNative
        $list = @(); $hint = ''; $reason = ''
        if ($nat.state -eq 'noiface') { $reason = 'noadapter' }
        if ($nat.nets.Count -gt 0) {
          $list = @($nat.nets | ForEach-Object { $_.saved = [bool]($_.saved -or ($saved -contains $_.ssid)); $_ })
          if (-not $cur -and $nat.connected) { $cur = $nat.connected }
        } elseif ($reason -ne 'noadapter') {
          $ns = Get-WifiNetsh $saved
          $list = @($ns.nets)
          if ($list.Count -eq 0) { $hint = $ns.first; $reason = 'empty' }
        }
        $list = @($list | Sort-Object @{ e = { $_.signal }; Descending = $true } | Select-Object -First 40)
        $o = [ordered]@{ connected = $cur; networks = $list; saved = $saved; hint = $hint; reason = $reason; native = ($nat.state -eq 'ok') }
        $r = ConvertTo-Json -InputObject $o -Compress -Depth 5
      }
      'wificonnect' {
        $a = ConvertFrom-Json $line.Substring(12)
        $ssid = [string]$a.ssid; $pw = [string]$a.password; $auth = [string]$a.auth
        $res = [ordered]@{ ok = $false; text = '' }
        if ($ssid -match '["\r\n]') { $res.text = 'That network name has characters this app cannot use. Connect from Windows Wi-Fi settings.' }
        else {
          $wasSaved = [bool]((Get-SavedWifi) -contains $ssid)
          $added = $false; $go = $true
          if ($pw -or -not $wasSaved) {
            # Build a Windows Wi-Fi profile (open, WPA2-Personal or WPA3-Personal) and add it for the current user.
            if ($auth -match 'Enterprise|802\.1X|WEP|Shared|Enhanced') { $go = $false; $res.text = 'That network type needs Windows Wi-Fi settings (' + $auth + ').'; $res.windows = $true }
            elseif ($auth -match '^Open' -or (-not $auth -and -not $pw)) { $authX = 'open'; $encX = 'none'; $keyX = '' }
            elseif (-not $pw) { $go = $false; $res.text = 'Enter the Wi-Fi password.'; $res.needPassword = $true }
            else {
              $authX = if ($auth -match 'WPA3' -and $auth -notmatch 'WPA2') { 'WPA3SAE' } else { 'WPA2PSK' }
              $encX = 'AES'
              $keyX = '<sharedKey><keyType>passphrase</keyType><protected>false</protected><keyMaterial>' + (XmlEsc $pw) + '</keyMaterial></sharedKey>'
            }
            if ($go) {
              $x = '<?xml version="1.0"?><WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1"><name>' + (XmlEsc $ssid) + '</name><SSIDConfig><SSID><name>' + (XmlEsc $ssid) + '</name></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>auto</connectionMode><MSM><security><authEncryption><authentication>' + $authX + '</authentication><encryption>' + $encX + '</encryption><useOneX>false</useOneX></authEncryption>' + $keyX + '</security></MSM></WLANProfile>'
              $f = Join-Path ([IO.Path]::GetTempPath()) ('di-' + [guid]::NewGuid().ToString('N') + '.xml')
              try {
                [IO.File]::WriteAllText($f, $x, (New-Object Text.UTF8Encoding($false)))
                [void](Netsh wlan add profile "filename=$f" user=current)
                if ($script:nsExit -ne 0) { $go = $false; $res.text = 'Windows would not accept that network profile.' } else { $added = $true }
              } finally { Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue }
            }
          }
          if ($go) {
            [void](Netsh wlan connect "name=$ssid")
            $ok = $false
            for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Milliseconds 500; $c = Get-WifiNow; if ($c -and $c.ssid -eq $ssid) { $ok = $true; break } }
            if ($ok) { $res.ok = $true; $res.text = 'Connected.' }
            else {
              $res.text = if ($pw) { 'Could not connect. Check the password and try again.' } else { 'Could not connect to ' + $ssid + '.' }
              if ($added -and -not $wasSaved) { [void](Netsh wlan delete profile "name=$ssid") }
            }
          }
        }
        $r = ConvertTo-Json -InputObject $res -Compress
      }
      'wifidisc' { [void](Netsh wlan disconnect); $r = 'ok' }
      'wififorget' {
        $a = ConvertFrom-Json $line.Substring(11)
        $ssid = [string]$a.ssid
        if (-not $ssid -or $ssid -match '["\r\n]') { $r = '{"ok":false}' }
        else { [void](Netsh wlan delete profile "name=$ssid"); $r = ConvertTo-Json -InputObject @{ ok = ($script:nsExit -eq 0) } -Compress }
      }
      'btlist' {
        $devs = @{}; $fallback = $false
        try {
          if (-not $script:winrt) { throw 'no winrt' }
          foreach ($mode in 'classic', 'le') {
            $sel = if ($mode -eq 'classic') { [Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelectorFromPairingState($true) } else { [Windows.Devices.Bluetooth.BluetoothLEDevice]::GetDeviceSelectorFromPairingState($true) }
            $col = Await ([Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($sel)) ([Windows.Devices.Enumeration.DeviceInformationCollection])
            foreach ($d in $col) {
              try {
                if ($mode -eq 'classic') { $bd = Await ([Windows.Devices.Bluetooth.BluetoothDevice]::FromIdAsync($d.Id)) ([Windows.Devices.Bluetooth.BluetoothDevice]); $kind = [string]$bd.ClassOfDevice.MajorClass }
                else { $bd = Await ([Windows.Devices.Bluetooth.BluetoothLEDevice]::FromIdAsync($d.Id)) ([Windows.Devices.Bluetooth.BluetoothLEDevice]); $kind = 'LE' }
                if (-not $bd) { continue }
                $nm = [string]$bd.Name; if (-not $nm) { $nm = [string]$d.Name }
                $cn = ([string]$bd.ConnectionStatus -eq 'Connected')
                $bd.Dispose()
                if (-not $nm) { continue }
                $key = $nm.ToLowerInvariant()
                if (-not $devs.ContainsKey($key) -or ($cn -and -not $devs[$key].connected)) { $devs[$key] = [pscustomobject]@{ name = $nm; connected = $cn; kind = $kind } }
              } catch {}
            }
          }
        } catch {
          # Fallback: paired devices from Device Manager (connection state is not known this way)
          $fallback = $true; $devs = @{}
          try {
            Get-PnpDevice -Class Bluetooth -PresentOnly -ErrorAction Stop | Where-Object { $_.FriendlyName -and $_.FriendlyName -notmatch 'Enumerator|Radio|Adapter|Transport|Generic|Microsoft Bluetooth|Intel\(R\)|Wireless Bluetooth|Service|Protocol|Gatt|Avrcp|Device Information|Audio Gateway|Handsfree|A2DP|Hands-Free' } |
              ForEach-Object { $devs[$_.FriendlyName.ToLowerInvariant()] = [pscustomobject]@{ name = $_.FriendlyName; connected = $null; kind = '' } }
          } catch {}
        }
        $list = @($devs.Values | Sort-Object @{ e = { [bool]$_.connected }; Descending = $true }, name)
        $r = ConvertTo-Json -InputObject ([ordered]@{ ok = $true; fallback = $fallback; devices = $list }) -Compress -Depth 4
      }
      'focus' {
        [Win]::Focus((Get-Process -Id ([int]$p[1])).MainWindowHandle)
        $r = 'ok'
      }
    }
  } catch { $r = 'ERR' }
  [Console]::Out.WriteLine(([string]$r -replace "[\r\n]+", ' '))
  [Console]::Out.Flush()
}
