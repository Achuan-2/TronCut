param([Parameter(Mandatory=$true)][string]$WindowHandle)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RecordingWindowDrag {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left, top, right, bottom; }
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
[RecordingWindowDrag]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null
$taskWindow = [IntPtr]::new([long]$WindowHandle)
$taskBefore = New-Object RecordingWindowDrag+Rect
if (-not [RecordingWindowDrag]::GetWindowRect($taskWindow, [ref]$taskBefore)) { throw 'Recording window already closed' }
$taskX = [int](($taskBefore.left + $taskBefore.right) / 2)
$taskY = [int](($taskBefore.top + $taskBefore.bottom) / 2)
[RecordingWindowDrag]::SetForegroundWindow($taskWindow) | Out-Null
[RecordingWindowDrag]::SetCursorPos($taskX, $taskY) | Out-Null
Start-Sleep -Milliseconds 150
[RecordingWindowDrag]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
try {
    Start-Sleep -Milliseconds 100
    for ($taskStep = 1; $taskStep -le 10; $taskStep++) {
        [RecordingWindowDrag]::SetCursorPos(($taskX - 12 * $taskStep), ($taskY - 8 * $taskStep)) | Out-Null
        Start-Sleep -Milliseconds 25
    }
} finally {
    [RecordingWindowDrag]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
}
Start-Sleep -Milliseconds 300
$taskAfter = New-Object RecordingWindowDrag+Rect
[RecordingWindowDrag]::GetWindowRect($taskWindow, [ref]$taskAfter) | Out-Null
@{ before = $taskBefore; after = $taskAfter } | ConvertTo-Json -Compress
