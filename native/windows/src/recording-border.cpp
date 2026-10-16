#include "dpi_awareness.h"
#include <dwmapi.h>
#include <algorithm>
#include <iostream>
#include <string>
#include <thread>

namespace {
constexpr wchar_t kClassName[] = L"TronCutRecordingBorder";
constexpr COLORREF kTransparent = RGB(0, 0, 0);
constexpr COLORREF kBorderColor = RGB(118, 229, 181); // Match the editor's green accent.
HWND target = nullptr;
HANDLE parent = nullptr;
RECT bounds{};

void paintBorder(HWND window, HDC dc) {
    RECT client{};
    GetClientRect(window, &client);
    FillRect(dc, &client, static_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));
    const int stroke = std::max(2, MulDiv(3, GetDpiForWindow(window), 96));
    const int dash = stroke * 4, period = dash + stroke * 2;
    HBRUSH brush = CreateSolidBrush(kBorderColor);
    for (int x = 0; x < client.right; x += period) {
        RECT top{x, 0, std::min<LONG>(x + dash, client.right), stroke};
        RECT bottom{x, client.bottom - stroke, top.right, client.bottom};
        FillRect(dc, &top, brush);
        FillRect(dc, &bottom, brush);
    }
    for (int y = 0; y < client.bottom; y += period) {
        RECT left{0, y, stroke, std::min<LONG>(y + dash, client.bottom)};
        RECT right{client.right - stroke, y, client.right, left.bottom};
        FillRect(dc, &left, brush);
        FillRect(dc, &right, brush);
    }
    DeleteObject(brush);
}

bool updateBounds(HWND window) {
    if (WaitForSingleObject(parent, 0) != WAIT_TIMEOUT || (target && !IsWindow(target))) {
        DestroyWindow(window);
        return false;
    }
    BOOL cloaked = FALSE;
    if (target) DwmGetWindowAttribute(target, DWMWA_CLOAKED, &cloaked, sizeof(cloaked));
    if (target && (!IsWindowVisible(target) || IsIconic(target) || cloaked)) {
        ShowWindow(window, SW_HIDE);
        return true;
    }
    RECT rect = bounds;
    if (target && FAILED(DwmGetWindowAttribute(target, DWMWA_EXTENDED_FRAME_BOUNDS, &rect, sizeof(rect))) &&
        !GetWindowRect(target, &rect)) return true;
    if (rect.right <= rect.left || rect.bottom <= rect.top) return true;
    RECT previous{};
    GetWindowRect(window, &previous);
    if (!EqualRect(&previous, &rect) || !IsWindowVisible(window)) {
        SetWindowPos(window, HWND_TOPMOST, rect.left, rect.top,
            rect.right - rect.left, rect.bottom - rect.top, SWP_NOACTIVATE | SWP_SHOWWINDOW);
        InvalidateRect(window, nullptr, FALSE);
        UpdateWindow(window);
        std::cout << "{\"event\":\"bounds\",\"x\":" << rect.left << ",\"y\":" << rect.top
            << ",\"width\":" << rect.right - rect.left << ",\"height\":" << rect.bottom - rect.top << "}" << std::endl;
    }
    return true;
}

LRESULT CALLBACK windowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam) {
    switch (message) {
    case WM_NCHITTEST: return HTTRANSPARENT;
    case WM_MOUSEACTIVATE: return MA_NOACTIVATE;
    case WM_ERASEBKGND: return 1;
    case WM_PAINT: {
        PAINTSTRUCT paint{};
        HDC dc = BeginPaint(window, &paint);
        paintBorder(window, dc);
        EndPaint(window, &paint);
        return 0;
    }
    case WM_PRINTCLIENT:
        paintBorder(window, reinterpret_cast<HDC>(wParam));
        return 0;
    case WM_TIMER:
        updateBounds(window);
        return 0;
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    default: return DefWindowProcW(window, message, wParam, lParam);
    }
}
}

int wmain(int argc, wchar_t* argv[]) {
    if (!enablePerMonitorV2DpiAwareness()) return 1;
    DWORD parentId = 0;
    try {
        if (argc == 4 && std::wstring(argv[1]) == L"--window") {
            target = reinterpret_cast<HWND>(static_cast<uintptr_t>(std::stoull(argv[2])));
            parentId = std::stoul(argv[3]);
            if (!IsWindow(target)) return 1;
        } else if (argc == 7 && std::wstring(argv[1]) == L"--display") {
            bounds.left = std::stol(argv[2]);
            bounds.top = std::stol(argv[3]);
            const long width = std::stol(argv[4]), height = std::stol(argv[5]);
            if (width <= 0 || height <= 0 || width > 32768 || height > 32768) return 1;
            bounds.right = bounds.left + width;
            bounds.bottom = bounds.top + height;
            parentId = std::stoul(argv[6]);
        } else return 1;
    } catch (...) { return 1; }
    parent = OpenProcess(SYNCHRONIZE, FALSE, parentId);
    if (!parent) return 1;
    WNDCLASSEXW cls{sizeof(cls)};
    cls.lpfnWndProc = windowProc;
    cls.hInstance = GetModuleHandleW(nullptr);
    cls.lpszClassName = kClassName;
    if (!RegisterClassExW(&cls)) { CloseHandle(parent); return 1; }
    HWND window = CreateWindowExW(
        WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
        kClassName, L"TronCut Recording Border", WS_POPUP, 0, 0, 1, 1,
        nullptr, nullptr, cls.hInstance, nullptr);
    // Never display an indicator that could be baked into the user's video.
    if (!window || !SetLayeredWindowAttributes(window, kTransparent, 255, LWA_COLORKEY) ||
        !SetWindowDisplayAffinity(window, WDA_EXCLUDEFROMCAPTURE)) {
        std::cerr << "Unable to create a capture-excluded recording border: " << GetLastError() << std::endl;
        if (window) DestroyWindow(window);
        CloseHandle(parent);
        return 1;
    }
    if (!updateBounds(window)) { CloseHandle(parent); return 1; }
    SetTimer(window, 1, 50, nullptr);
    std::cout << "{\"event\":\"ready\",\"handle\":\"" << reinterpret_cast<uintptr_t>(window) << "\"}" << std::endl;
    // EOF also closes the border when Electron exits or closes its pipe.
    std::thread([window]() {
        std::string command;
        while (std::getline(std::cin, command)) {
            if (command == "stop") break;
        }
        PostMessageW(window, WM_CLOSE, 0, 0);
    }).detach();
    MSG message{};
    while (GetMessageW(&message, nullptr, 0, 0) > 0) {
        TranslateMessage(&message);
        DispatchMessageW(&message);
    }
    CloseHandle(parent);
    return 0;
}
