<#
.SYNOPSIS
  Installs, removes, runs or inspects the labctl expiry-sweep scheduled task.
.DESCRIPTION
  The task runs scripts/sweep.ts at logon and whenever the workstation is unlocked, so expired labs are
  destroyed even when the labctl app is closed. It runs as you (interactive, no stored password), hidden,
  and never starts a second copy while one is still running. Output goes to data/logs/sweep.log.
.EXAMPLE
  npm run task -- -Install
  npm run task -- -Status
  npm run task -- -Run
  npm run task -- -Uninstall
#>
param(
  [switch]$Install,
  [switch]$Uninstall,
  [switch]$Run,
  [switch]$Status
)

$ErrorActionPreference = 'Stop'
$TaskName = 'labctl expiry sweep'
$TaskPath = '\labctl\'
$Root = Split-Path -Parent $PSScriptRoot
$Node = (Get-Command node -ErrorAction Stop).Source
$User = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

function Get-LabctlTask { Get-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -ErrorAction SilentlyContinue }

if ($Install) {
  # conhost --headless keeps the console hidden; node --import tsx runs the TypeScript sweep directly.
  $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\conhost.exe" `
    -Argument "--headless `"$Node`" --import tsx scripts\sweep.ts --trigger=task" `
    -WorkingDirectory $Root

  $logon = New-ScheduledTaskTrigger -AtLogOn -User $User
  $logon.Delay = 'PT1M'   # let the network come up

  # Workstation unlock (TASK_SESSION_UNLOCK = 8) has no cmdlet; build the CIM trigger directly.
  $unlockClass = Get-CimClass -Namespace Root/Microsoft/Windows/TaskScheduler -ClassName MSFT_TaskSessionStateChangeTrigger
  $unlock = New-CimInstance -CimClass $unlockClass -ClientOnly -Property @{ StateChange = 8; UserId = $User; Delay = 'PT30S'; Enabled = $true }

  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited

  Register-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Action $action -Trigger @($logon, $unlock) `
    -Settings $settings -Principal $principal -Force `
    -Description 'Destroys expired labctl labs (managedBy=labctl, expiresOn in the past) at logon and unlock. Log: data\logs\sweep.log' | Out-Null
  Write-Host "Installed '$TaskPath$TaskName' (logon + unlock) for $User"
}

if ($Uninstall) {
  if (Get-LabctlTask) { Unregister-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath -Confirm:$false; Write-Host "Removed '$TaskPath$TaskName'" }
  else { Write-Host 'Task not installed' }
}

if ($Run) {
  Start-ScheduledTask -TaskName $TaskName -TaskPath $TaskPath
  Write-Host "Started; see $Root\data\logs\sweep.log"
}

if ($Status -or -not ($Install -or $Uninstall -or $Run)) {
  $t = Get-LabctlTask
  if (-not $t) { Write-Host 'Task not installed. Run: npm run task -- -Install'; return }
  $i = $t | Get-ScheduledTaskInfo
  [pscustomobject]@{
    Task           = "$TaskPath$TaskName"
    State          = $t.State
    Triggers       = ($t.Triggers | ForEach-Object { $_.CimClass.CimClassName -replace 'MSFT_Task', '' -replace 'Trigger', '' }) -join ', '
    LastRun        = $i.LastRunTime
    LastResult     = '0x{0:X}' -f $i.LastTaskResult
  } | Format-List
  $log = Join-Path $Root 'data\logs\sweep.log'
  if (Test-Path $log) { Write-Host 'Recent log:'; Get-Content $log -Tail 5 }
}
