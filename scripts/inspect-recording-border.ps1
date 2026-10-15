param([string]$TargetHandle = '0')
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BorderInspection {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left, top, right, bottom; }
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr w, out Rect r);
    [DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(IntPtr w, out uint affinity);
    [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtr(IntPtr w, int index);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr w);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr w, int attr, out Rect rect, int size);
}
'@
[BorderInspection]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null
$taskWindow = [BorderInspection]::FindWindow('TronCutRecordingBorder', 'TronCut Recording Border')
if ($taskWindow -eq [IntPtr]::Zero) { '{"exists":false}'; exit 0 }
$taskRect = New-Object BorderInspection+Rect
[BorderInspection]::GetWindowRect($taskWindow, [ref]$taskRect) | Out-Null
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
} | ConvertTo-Json -Depth 3 -Compress
