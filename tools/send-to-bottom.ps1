# Send a window to the bottom of the z-order (desktop layer), on demand.
# Used by the "pin to desktop" mode: the board stays on screen but never
# covers other applications.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File send-to-bottom.ps1 <hwnd-hex>
# Then write "bottom" lines to stdin to push it back down again.
param([Parameter(Mandatory = $true)][string]$Target)

$code = @'
using System;
using System.Runtime.InteropServices;

public static class ZOrder {
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
        int X, int Y, int cx, int cy, uint uFlags);

    // HWND_BOTTOM = 1
    // SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOOWNERZORDER
    public static bool ToBottom(IntPtr h) {
        return SetWindowPos(h, (IntPtr)1, 0, 0, 0, 0, 0x0213);
    }
}
'@

Add-Type -TypeDefinition $code -Language CSharp

$hwnd = [IntPtr]([Convert]::ToInt64($Target, 16))
[void][ZOrder]::ToBottom($hwnd)

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }
    if ($line.Trim() -eq 'bottom') { [void][ZOrder]::ToBottom($hwnd) }
}
