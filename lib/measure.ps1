param([string]$Label = "run", [int]$Runs = 3, [int]$Settle = 16, [int]$Window = 12)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W32 { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int c); }
"@ 2>$null

$exe = "D:\嘉豪\edex-ui-master\node_modules\electron\dist\electron.exe"
$rows = @()

for ($i = 1; $i -le $Runs; $i++) {
    Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Remove-Item Env:ELECTRON_RUN_AS_NODE,Env:EDEX_PROBE,Env:EDEX_EVAL_FILE -ErrorAction SilentlyContinue

    $p = Start-Process -FilePath $exe -ArgumentList "src","--nointro" -NoNewWindow -RedirectStandardOutput "$env:TEMP\$Label-$i.log" -RedirectStandardError "$env:TEMP\$Label-$i.err" -PassThru
    Start-Sleep -Seconds $Settle

    function Snap { $s=@{}; foreach ($cp in Get-CimInstance Win32_Process -Filter "Name='electron.exe'") { $ps=Get-Process -Id $cp.ProcessId -ErrorAction SilentlyContinue; if ($ps) { $s[$ps.Id]=$ps.CPU } }; return $s }
    function D([hashtable]$a,[hashtable]$b,[int]$sec) { $c=0.0; $n=0; foreach ($k in $b.Keys) { $n++; if ($a.ContainsKey($k)) { $c += ($b[$k]-$a[$k]) } else { $c += $b[$k] } }; return @($c, $n) }

    $ws = 0.0
    foreach ($cp in Get-CimInstance Win32_Process -Filter "Name='electron.exe'") { $ps = Get-Process -Id $cp.ProcessId -ErrorAction SilentlyContinue; if ($ps) { $ws += $ps.WorkingSet64/1MB } }

    $a = Snap
    Start-Sleep -Seconds $Window
    $b = Snap
    $d = D $a $b $Window

    $mainPid = (Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -match 'src --nointro' }).ProcessId
    $mp = Get-Process -Id $mainPid -ErrorAction SilentlyContinue
    [W32]::ShowWindowAsync($mp.MainWindowHandle, 6) | Out-Null
    Start-Sleep -Seconds 3
    $c = Snap
    Start-Sleep -Seconds $Window
    $e = Snap
    $d2 = D $c $e $Window

    $rows += [pscustomobject]@{
        Run = $i; Procs = $d[1]; WS_MB = [math]::Round($ws)
        Vis_pct = [math]::Round($d[0]/$Window*100)
        Min_pct = [math]::Round($d2[0]/$Window*100)
    }
    Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

$rows | Format-Table -AutoSize
$mid = [math]::Floor($Runs/2)
$mv = ($rows | Sort-Object Vis_pct | Select-Object -Skip $mid -First 1).Vis_pct
$mm = ($rows | Sort-Object Min_pct | Select-Object -Skip $mid -First 1).Min_pct
$mw = ($rows | Sort-Object WS_MB   | Select-Object -Skip $mid -First 1).WS_MB
$mp2 = ($rows | Sort-Object Procs  | Select-Object -Skip $mid -First 1).Procs
"MEDIAN [$Label]: procs=$mp2 WS=${mw}MB visible=${mv}% minimized=${mm}%"
