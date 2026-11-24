# Dynamic Island text expander helper (local only). Started by main.js ONLY while "Text expander" is switched on in Settings.
#
# What it does: watches typing system-wide (a standard low-level keyboard hook, the same mechanism AutoHotkey / Espanso use)
# and, when what you just typed ends with one of your snippet triggers (for example ;sig), prints  "hit <trigger>"  on stdout.
# main.js then asks it to delete the trigger and type / paste the snippet.
#
# What it does NOT do:
#   - It never prints, logs, stores or sends the keys you type. The only thing that leaves this process is "hit <trigger>".
#   - It keeps at most the last 32 typed characters in memory, and forgets them on Enter, Tab, Esc, arrows, shortcuts (Ctrl / Alt / Win) and after a hit.
#   - It ignores keys that other programs inject, so it cannot trigger itself.
#   - No network, no files, no registry, no elevation.
# Commands (stdin, one per line):  triggers <json array> | replace <json {back,mode,text,left}> | quit
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System; using System.Collections.Generic; using System.Diagnostics; using System.Runtime.InteropServices; using System.Text; using System.Threading;
[StructLayout(LayoutKind.Sequential)] public struct KBD { public uint vk, scan, flags, time; public IntPtr extra; }
[StructLayout(LayoutKind.Sequential)] public struct PT { public int x, y; }
[StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public PT pt; }
public delegate IntPtr LLProc(int code, IntPtr wParam, IntPtr lParam);
public static class Hook {
  [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int id, LLProc p, IntPtr mod, uint thread);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr h, int code, IntPtr w, IntPtr l);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr GetModuleHandle(string n);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint a, uint b);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vk);
  [DllImport("user32.dll")] static extern short GetKeyState(int vk);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetKeyboardLayout(uint thread);
  [DllImport("user32.dll")] static extern int ToUnicodeEx(uint vk, uint scan, byte[] state, StringBuilder buf, int size, uint flags, IntPtr layout);
  static LLProc proc = Callback;
  static IntPtr hh = IntPtr.Zero;
  static StringBuilder buf = new StringBuilder();
  static string[] triggers = new string[0];
  static object gate = new object();
  public static int Error = 0;

  public static void SetTriggers(string[] t) { lock (gate) { triggers = t; buf.Length = 0; } }
  public static void Reset() { lock (gate) { buf.Length = 0; } }
  public static void Start() {
    Thread th = new Thread(Run); th.IsBackground = true; th.Start();
  }
  static void Run() {
    IntPtr mod = GetModuleHandle(Process.GetCurrentProcess().MainModule.ModuleName);
    hh = SetWindowsHookEx(13, proc, mod, 0);   // WH_KEYBOARD_LL
    if (hh == IntPtr.Zero) { Error = Marshal.GetLastWin32Error(); Console.Out.WriteLine("error hook " + Error); Console.Out.Flush(); return; }
    MSG m; while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { }
  }
  static IntPtr Callback(int code, IntPtr wParam, IntPtr lParam) {
    if (code >= 0) {
      int msg = wParam.ToInt32();
      if (msg == 0x100 || msg == 0x104) {   // WM_KEYDOWN / WM_SYSKEYDOWN
        try { Handle((KBD)Marshal.PtrToStructure(lParam, typeof(KBD))); } catch (Exception) { }
      }
    }
    return CallNextHookEx(hh, code, wParam, lParam);
  }
  static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }
  static void Handle(KBD k) {
    if ((k.flags & 0x12) != 0) return;   // LLKHF_INJECTED (0x10) / LLKHF_LOWER_IL_INJECTED (0x02): not typed by the user
    uint vk = k.vk;
    lock (gate) {
      if (triggers.Length == 0) return;
      if (vk == 0x08) { if (buf.Length > 0) buf.Length--; return; }                                   // Backspace
      if ((vk >= 0x10 && vk <= 0x12) || (vk >= 0xA0 && vk <= 0xA5) || vk == 0x14 || vk == 0x90 || vk == 0x91 || vk == 0x5B || vk == 0x5C) return;   // modifiers, locks
      bool ctrl = Down(0x11), alt = Down(0x12), win = Down(0x5B) || Down(0x5C);
      bool altGr = ctrl && alt;                                                                      // AltGr = Ctrl+Alt on many layouts: it is typing
      if (win || ((ctrl || alt) && !altGr)) { buf.Length = 0; return; }                              // shortcuts end the word
      if (vk == 0x0D || vk == 0x09 || vk == 0x1B || (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || (vk >= 0x70 && vk <= 0x87)) { buf.Length = 0; return; }
      byte[] ks = new byte[256];
      if (Down(0x10)) ks[0x10] = 0x80;
      if ((GetKeyState(0x14) & 1) != 0) ks[0x14] = 1;
      if (altGr) { ks[0x11] = 0x80; ks[0x12] = 0x80; }
      uint pid; IntPtr fg = GetForegroundWindow(); uint th = GetWindowThreadProcessId(fg, out pid);
      StringBuilder sb = new StringBuilder(8);
      int n = ToUnicodeEx(vk, k.scan, ks, sb, sb.Capacity, 4, GetKeyboardLayout(th));   // flag 4: do not disturb the keyboard's dead-key state
      if (n <= 0) return;
      for (int i = 0; i < n; i++) { char c = sb[i]; if (char.IsControl(c)) { buf.Length = 0; return; } buf.Append(c); }
      if (buf.Length > 32) buf.Remove(0, buf.Length - 32);
      string s = buf.ToString();
      for (int i = 0; i < triggers.Length; i++) {
        if (s.EndsWith(triggers[i], StringComparison.Ordinal)) {
          buf.Length = 0;
          Console.Out.WriteLine("hit\t" + triggers[i]); Console.Out.Flush();
          return;
        }
      }
    }
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
  public static void ReleaseModifiers() {
    List<INPUT> l = new List<INPUT>();
    int[] mods = new int[] { 0x10, 0x11, 0x12, 0x5B, 0x5C };
    foreach (int vk in mods) if ((GetAsyncKeyState(vk) & 0x8000) != 0) l.Add(K((ushort)vk, 0, 2));
    Send(l);
  }
  public static void CtrlV() { List<INPUT> l = new List<INPUT>(); l.Add(K(0x11, 0, 0)); l.Add(K(0x56, 0, 0)); l.Add(K(0x56, 0, 2)); l.Add(K(0x11, 0, 2)); Send(l); }
  public static void Backspaces(int n) { List<INPUT> l = new List<INPUT>(); for (int i = 0; i < n; i++) { l.Add(K(0x08, 0, 0)); l.Add(K(0x08, 0, 2)); } Send(l); }
  public static void Left(int n) { List<INPUT> l = new List<INPUT>(); for (int i = 0; i < n; i++) { l.Add(K(0x25, 0, 0)); l.Add(K(0x25, 0, 2)); } Send(l); }
  public static void TypeText(string s) {
    List<INPUT> l = new List<INPUT>();
    foreach (char c in s) { l.Add(K(0, (ushort)c, 4)); l.Add(K(0, (ushort)c, 4 | 2)); }
    Send(l);
  }
}
"@

[Hook]::Start()
[Console]::Out.WriteLine('ready'); [Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $r = 'ERR'
  try {
    $sp = $line.IndexOf(' ')
    $cmd = if ($sp -lt 0) { $line } else { $line.Substring(0, $sp) }
    $arg = if ($sp -lt 0) { '' } else { $line.Substring($sp + 1) }
    switch ($cmd) {
      'triggers' { $a = @(ConvertFrom-Json $arg); [Hook]::SetTriggers([string[]]$a); $r = 'ok' }
      'replace' {
        $a = ConvertFrom-Json $arg
        [Kb]::ReleaseModifiers()
        if ([int]$a.back -gt 0) { [Kb]::Backspaces([int]$a.back) }
        if ([string]$a.mode -eq 'type') { [Kb]::TypeText([string]$a.text) } else { Start-Sleep -Milliseconds 40; [Kb]::CtrlV() }
        if ([int]$a.left -gt 0) { Start-Sleep -Milliseconds 60; [Kb]::Left([int]$a.left) }
        [Hook]::Reset()
        $r = 'done'
      }
      'quit' { exit }
    }
  } catch { $r = 'ERR ' + ($_.Exception.Message -replace '[\r\n]+', ' ') }
  [Console]::Out.WriteLine($r); [Console]::Out.Flush()
}
