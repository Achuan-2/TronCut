param([string]$TargetHandle = '0', [string]$OverlayHandle = '0')
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class BorderInspection {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int x, y; }
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr w, out Rect r);
    [DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(IntPtr w, out uint affinity);
    [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr w, int index);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr w);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
    [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr w, uint flags);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr w, StringBuilder text, int max);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr w, StringBuilder text, int max);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr w, int attr, out Rect rect, int size);
}
'@
[BorderInspection]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null
$taskWindow = [BorderInspection]::FindWindow('TronCutRecordingBorder', 'TronCut Recording Border')
if ($OverlayHandle -ne '0') { $taskWindow = [IntPtr]::new([long]$OverlayHandle) }
if ($taskWindow -eq [IntPtr]::Zero) { '{"exists":false}'; exit 0 }
$taskRect = New-Object BorderInspection+Rect
[BorderInspection]::GetWindowRect($taskWindow, [ref]$taskRect) | Out-Null
$taskCenter = New-Object BorderInspection+Point
$taskCenter.x = ($taskRect.left + $taskRect.right) / 2
$taskCenter.y = ($taskRect.top + $taskRect.bottom) / 2
$taskHit = [BorderInspection]::GetAncestor([BorderInspection]::WindowFromPoint($taskCenter), 2)
$taskHitTitle = New-Object System.Text.StringBuilder 512
$taskHitClass = New-Object System.Text.StringBuilder 256
[BorderInspection]::GetWindowText($taskHit, $taskHitTitle, 512) | Out-Null
[BorderInspection]::GetClassName($taskHit, $taskHitClass, 256) | Out-Null
[uint32]$taskAffinity = 0
[BorderInspection]::GetWindowDisplayAffinity($taskWindow, [ref]$taskAffinity) | Out-Null
$taskTargetRect = New-Object BorderInspection+Rect
if ($TargetHandle -ne '0') {
    [BorderInspection]::DwmGetWindowAttribute([IntPtr]::new([long]$TargetHandle), 9, [ref]$taskTargetRect, 16) | Out-Null
}
@{
    exists = $true; visible = [BorderInspection]::IsWindowVisible($taskWindow)
    bounds = $taskRect; targetBounds = $taskTargetRect
    affinity = $taskAffinity; style = [BorderInspection]::GetWindowLongPtr($taskWindow, -20).ToInt64()
    foreground = [BorderInspection]::GetForegroundWindow().ToInt64().ToString()
    handle = $taskWindow.ToInt64().ToString()
    topAtCenter = $taskHit -eq $taskWindow
    hitHandle = $taskHit.ToInt64().ToString()
    hitTitle = $taskHitTitle.ToString()
    hitClass = $taskHitClass.ToString()
} | ConvertTo-Json -Depth 3 -Compress
