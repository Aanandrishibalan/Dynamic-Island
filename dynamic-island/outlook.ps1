# Dynamic Island - Outlook reader (local only, no network).
# Talks to the classic Outlook desktop app that is already running, through its own COM interface.
#   list        -> JSON with the unread count and the newest unread mails in the Inbox
#   open <id>   -> shows one mail in Outlook (id = the EntryID returned by "list")
# It does not send, delete, move or mark anything.
param([string]$Cmd = 'list', [string]$Id = '')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
function Emit($o) { [Console]::Out.WriteLine((ConvertTo-Json -InputObject $o -Compress -Depth 5)) }
try {
  $ol = $null
  try { $ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application') } catch {}
  if ($Cmd -eq 'open') {
    if ($Id -notmatch '^[0-9A-Fa-f]+$') { throw 'bad id' }
    if (-not $ol) { $ol = New-Object -ComObject Outlook.Application }
    $ol.GetNamespace('MAPI').GetItemFromID($Id).Display()
    Emit @{ ok = $true }; exit 0
  }
  if (-not $ol) { Emit @{ ok = $false; error = 'not-running' }; exit 0 }
  $inbox = $ol.GetNamespace('MAPI').GetDefaultFolder(6)      # 6 = Inbox
  $unread = [int]$inbox.UnReadItemCount
  $un = $inbox.Items.Restrict('[UnRead] = True')
  $un.Sort('[ReceivedTime]', $true)
  $items = @(); $m = $un.GetFirst()
  while ($m -ne $null -and $items.Count -lt 20) {
    if ($m.Class -eq 43) {                                    # 43 = MailItem
      $pv = ''
      try { $pv = ([string]$m.Body).Trim(); if ($pv.Length -gt 160) { $pv = $pv.Substring(0, 160) }; $pv = $pv -replace '\s+', ' ' } catch {}
      $items += [pscustomobject]@{ id = [string]$m.EntryID; from = [string]$m.SenderName; subject = [string]$m.Subject; preview = $pv; date = ([datetime]$m.ReceivedTime).ToString('o') }
    }
    $m = $un.GetNext()
  }
  Emit @{ ok = $true; unread = $unread; items = $items }
} catch {
  Emit @{ ok = $false; error = [string]$_.Exception.Message }
}
