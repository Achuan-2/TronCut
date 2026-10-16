param([Parameter(Mandatory=$true)][string]$OverlayHandle)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CountdownInput {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int x, y; }
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr w, out Rect r);
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr w, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
[CountdownInput]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null
$taskOverlay = [IntPtr]::new([long]$OverlayHandle)
$taskBounds = New-Object CountdownInput+Rect
if (-not [CountdownInput]::GetWindowRect($taskOverlay, [ref]$taskBounds)) { throw 'Countdown already closed' }
$taskPoint = New-Object CountdownInput+Point
$taskPoint.x = ($taskBounds.left + $taskBounds.right) / 2
$taskPoint.y = ($taskBounds.top + $taskBounds.bottom) / 2
$taskHit = [CountdownInput]::GetAncestor([CountdownInput]::WindowFromPoint($taskPoint), 2)
[CountdownInput]::SetCursorPos($taskPoint.x, $taskPoint.y) | Out-Null
[CountdownInput]::mouse_event(2,0,0,0,[UIntPtr]::Zero)
[CountdownInput]::mouse_event(4,0,0,0,[UIntPtr]::Zero)
@{ hitHandle=$taskHit.ToInt64().ToString(); foreground=[CountdownInput]::GetForegroundWindow().ToInt64().ToString(); overlay=$OverlayHandle } | ConvertTo-Json -Compress
