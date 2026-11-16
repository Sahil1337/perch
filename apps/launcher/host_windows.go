package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"syscall"
	"unsafe"

	"github.com/jchv/go-webview2/pkg/edge"
	"golang.org/x/sys/windows"

	"perch-launcher/core"
	"perch-launcher/webui"
)

const (
	title     = "Perch — SQL Client"
	className = "PerchLauncher"
	width     = 480 // logical pixels; scaled by the window's DPI
	height    = 340
	minWidth  = 400
	minHeight = 300
	// The page's night sky, painted before WebView2 draws so the window never flashes white.
	background = 0x0a0a0a

	wmDispatch = 0x8000 + 1 // WM_APP+1
	wmTray     = 0x8000 + 2
)

var (
	user32                    = windows.NewLazySystemDLL("user32.dll")
	procRegisterClassExW      = user32.NewProc("RegisterClassExW")
	procCreateWindowExW       = user32.NewProc("CreateWindowExW")
	procDefWindowProcW        = user32.NewProc("DefWindowProcW")
	procShowWindow            = user32.NewProc("ShowWindow")
	procGetMessageW           = user32.NewProc("GetMessageW")
	procTranslateMessage      = user32.NewProc("TranslateMessage")
	procDispatchMessageW      = user32.NewProc("DispatchMessageW")
	procPostMessageW          = user32.NewProc("PostMessageW")
	procPostQuitMessage       = user32.NewProc("PostQuitMessage")
	procDestroyWindow         = user32.NewProc("DestroyWindow")
	procSetWindowPos          = user32.NewProc("SetWindowPos")
	procGetDpiForWindow       = user32.NewProc("GetDpiForWindow")
	procGetDpiForSystem       = user32.NewProc("GetDpiForSystem")
	procAdjustWindowRectExDpi = user32.NewProc("AdjustWindowRectExForDpi")
	procGetSystemMetrics      = user32.NewProc("GetSystemMetrics")
	procLoadImageW            = user32.NewProc("LoadImageW")
	procLoadCursorW           = user32.NewProc("LoadCursorW")
	procFindWindowW           = user32.NewProc("FindWindowW")
	procSetForegroundWindow   = user32.NewProc("SetForegroundWindow")
	procIsIconic              = user32.NewProc("IsIconic")
	gdi32                     = windows.NewLazySystemDLL("gdi32.dll")
	procCreateSolidBrush      = gdi32.NewProc("CreateSolidBrush")
	shell32                   = windows.NewLazySystemDLL("shell32.dll")
	procShellNotifyIconW      = shell32.NewProc("Shell_NotifyIconW")
	errWebView2Missing        = errors.New("Perch needs the Microsoft Edge WebView2 Runtime. Reinstall Perch to add it, or install it from microsoft.com/edge/webview2.")
	theHost                   *host
)

// Slots in the WebView2 COM vtables, counted from WebView2.h (SDK 1.0.3240.44). go-webview2
// wraps none of these, so they are called directly.
const (
	slotAddWebMessageReceived = 34 // ICoreWebView2
	slotTrySuspend            = 68 // ICoreWebView2_3
	slotResume                = 69 // ICoreWebView2_3
	slotGetWebMessageAsJSON   = 4  // ICoreWebView2WebMessageReceivedEventArgs
)

type host struct {
	app      *core.App
	hwnd     uintptr
	chromium *edge.Chromium
	uiThread uint32

	webview   unsafe.Pointer // ICoreWebView2_3
	onMessage *comHandler
	onSuspend *comHandler

	mu        sync.Mutex
	queue     []func()
	minimised bool
	closing   bool
	job       windows.Handle
	tray      bool
}

func run() error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	if !claimSingleInstance() {
		return nil
	}

	h := &host{app: core.New(self, Version), uiThread: windows.GetCurrentThreadId()}
	theHost = h
	if err := h.createWindow(); err != nil {
		return h.fatal(err)
	}
	if err := h.embed(); err != nil {
		return h.fatal(err)
	}
	h.app.Start(h)
	h.loop()
	return nil
}

// claimSingleInstance focuses the open launcher instead of starting a second WebView2. The
// launcher that `perch update` relaunches waits for the old one to let go instead.
func claimSingleInstance() bool {
	name, _ := windows.UTF16PtrFromString(`Local\PerchLauncher`)
	mutex, err := windows.CreateMutex(nil, true, name)
	if !errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		return true
	}
	if slices.Contains(os.Args[1:], core.RelaunchFlag) {
		ev, _ := windows.WaitForSingleObject(mutex, 20000)
		return ev == windows.WAIT_OBJECT_0 || ev == windows.WAIT_ABANDONED
	}
	cls, _ := windows.UTF16PtrFromString(className)
	if hwnd, _, _ := procFindWindowW.Call(uintptr(unsafe.Pointer(cls)), 0); hwnd != 0 {
		if iconic, _, _ := procIsIconic.Call(hwnd); iconic != 0 {
			procShowWindow.Call(hwnd, 9) // SW_RESTORE
		}
		procSetForegroundWindow.Call(hwnd)
	}
	return false
}

func (h *host) fatal(err error) error {
	windows.MessageBox(windows.HWND(h.hwnd), utf16(err.Error()), utf16(title), windows.MB_OK|windows.MB_ICONERROR)
	return err
}

func (h *host) createWindow() error {
	instance := moduleHandle()
	cls := utf16(className)
	icon := func(metric uintptr) uintptr {
		size, _, _ := procGetSystemMetrics.Call(metric)
		hicon, _, _ := procLoadImageW.Call(uintptr(instance), uintptr(unsafe.Pointer(utf16("APP"))), 1, size, size, 0x8000) // IMAGE_ICON, LR_SHARED
		return hicon
	}
	cursor, _, _ := procLoadCursorW.Call(0, 32512) // IDC_ARROW
	brush, _, _ := procCreateSolidBrush.Call(background)
	wc := wndClassEx{
		Size:       uint32(unsafe.Sizeof(wndClassEx{})),
		WndProc:    windows.NewCallback(wndproc),
		Instance:   uintptr(instance),
		Icon:       icon(11), // SM_CXICON
		IconSm:     icon(49), // SM_CXSMICON
		Cursor:     cursor,
		Background: brush,
		ClassName:  cls,
	}
	if r, _, err := procRegisterClassExW.Call(uintptr(unsafe.Pointer(&wc))); r == 0 {
		return err
	}

	const style = 0x00CF0000 // WS_OVERLAPPEDWINDOW
	dpi, _, _ := procGetDpiForSystem.Call()
	w, hgt := outerSize(width, height, dpi, style)
	sw, _, _ := procGetSystemMetrics.Call(0) // SM_CXSCREEN
	sh, _, _ := procGetSystemMetrics.Call(1)
	var err error
	h.hwnd, _, err = procCreateWindowExW.Call(0, uintptr(unsafe.Pointer(cls)), uintptr(unsafe.Pointer(utf16(title))), style,
		uintptr(max(0, (int32(sw)-w)/2)), uintptr(max(0, (int32(sh)-hgt)/2)), uintptr(w), uintptr(hgt), 0, 0, uintptr(instance), 0)
	if h.hwnd == 0 {
		return err
	}

	// The native title bar goes dark to meet the night sky. 19 is the attribute's id on Windows 10
	// builds before 20H1.
	dark := int32(1)
	if windows.DwmSetWindowAttribute(windows.HWND(h.hwnd), windows.DWMWA_USE_IMMERSIVE_DARK_MODE, unsafe.Pointer(&dark), 4) != nil {
		_ = windows.DwmSetWindowAttribute(windows.HWND(h.hwnd), 19, unsafe.Pointer(&dark), 4)
	}
	procShowWindow.Call(h.hwnd, 1) // SW_SHOWNORMAL
	return nil
}

func outerSize(w, h int32, dpi uintptr, style uintptr) (int32, int32) {
	if dpi == 0 {
		dpi = 96
	}
	r := rect{Right: w * int32(dpi) / 96, Bottom: h * int32(dpi) / 96}
	procAdjustWindowRectExDpi.Call(uintptr(unsafe.Pointer(&r)), style, 0, 0, dpi)
	return r.Right - r.Left, r.Bottom - r.Top
}

func (h *host) embed() error {
	c := edge.NewChromium()
	// WebView2 keeps a sizeable profile; it belongs with other per-user app data, not beside the
	// exe and not in ~/.perch.
	if local, err := windows.KnownFolderPath(windows.FOLDERID_LocalAppData, 0); err == nil {
		c.DataPath = filepath.Join(local, "Perch", "WebView2")
	}
	h.chromium = c
	if !c.Embed(h.hwnd) {
		return errWebView2Missing
	}
	if s, err := c.GetSettings(); err == nil {
		// Off for people, but left on when the launcher was started with a debug port on purpose:
		// that is how the Windows CI job drives the real window.
		_ = s.PutAreDevToolsEnabled(strings.Contains(os.Getenv("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"), "--remote-debugging-port"))
		_ = s.PutAreDefaultContextMenusEnabled(false)
		_ = s.PutAreBrowserAcceleratorKeysEnabled(false)
		_ = s.PutIsZoomControlEnabled(false)
		_ = s.PutIsPinchZoomEnabled(false)
		_ = s.PutIsSwipeNavigationEnabled(false)
		_ = s.PutIsStatusBarEnabled(false)
	}
	if c2 := c.GetController().GetICoreWebView2Controller2(); c2 != nil {
		_ = c2.PutDefaultBackgroundColor(edge.COREWEBVIEW2_COLOR{A: 255, R: 0x0a, G: 0x0a, B: 0x0a})
	}

	if wv := c.GetICoreWebView2_3(); wv != nil {
		h.webview = unsafe.Pointer(wv)
	}
	if h.webview == nil {
		return errWebView2Missing
	}
	// go-webview2 reads messages with TryGetWebMessageAsString, which drops the objects the page
	// posts; read them as JSON with a handler of our own.
	h.onMessage = newHandler(func(_ *comHandler, _, args unsafe.Pointer) uintptr {
		var p *uint16
		comCall(args, slotGetWebMessageAsJSON, uintptr(unsafe.Pointer(&p)))
		if p != nil {
			msg := windows.UTF16PtrToString(p)
			windows.CoTaskMemFree(unsafe.Pointer(p))
			h.app.Handle([]byte(msg))
		}
		return 0
	})
	h.onSuspend = newHandler(func(_ *comHandler, _, _ unsafe.Pointer) uintptr { return 0 })
	var token int64
	comCall(h.webview, slotAddWebMessageReceived, uintptr(unsafe.Pointer(h.onMessage)), uintptr(unsafe.Pointer(&token)))

	c.Resize()
	c.NavigateToString(webui.Index)
	c.Focus()
	return nil
}

func (h *host) loop() {
	var m msg
	for {
		r, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			return
		}
		procTranslateMessage.Call(uintptr(unsafe.Pointer(&m)))
		procDispatchMessageW.Call(uintptr(unsafe.Pointer(&m)))
	}
}

func wndproc(hwnd, message, wp, lp uintptr) uintptr {
	h := theHost
	if h == nil || h.hwnd != hwnd || h.chromium == nil {
		r, _, _ := procDefWindowProcW.Call(hwnd, message, wp, lp)
		return r
	}
	switch message {
	case 0x0005: // WM_SIZE
		switch wp {
		case 1: // SIZE_MINIMIZED
			h.minimise()
		case 0, 2: // SIZE_RESTORED, SIZE_MAXIMIZED
			h.restore()
			h.chromium.Resize()
		}
		return 0
	case 0x0003, 0x0216: // WM_MOVE, WM_MOVING
		_ = h.chromium.NotifyParentWindowPositionChanged()
	case 0x0006: // WM_ACTIVATE
		if wp&0xffff != 0 {
			h.chromium.Focus()
		}
	case 0x0024: // WM_GETMINMAXINFO
		dpi, _, _ := procGetDpiForWindow.Call(hwnd)
		w, hgt := outerSize(minWidth, minHeight, dpi, 0x00CF0000)
		info := (*minMaxInfo)(ptr(lp))
		info.MinTrackSize = point{w, hgt}
		return 0
	case 0x02E0: // WM_DPICHANGED: take the size Windows suggests for the new monitor
		r := (*rect)(ptr(lp))
		procSetWindowPos.Call(hwnd, 0, uintptr(r.Left), uintptr(r.Top), uintptr(r.Right-r.Left), uintptr(r.Bottom-r.Top), 0x0014) // SWP_NOZORDER|SWP_NOACTIVATE
		return 0
	case 0x0010: // WM_CLOSE
		h.close()
		return 0
	case 0x0002: // WM_DESTROY
		h.removeTray()
		procPostQuitMessage.Call(0)
		return 0
	case wmDispatch:
		h.drain()
		return 0
	case wmTray:
		switch lp & 0xffff {
		case 0x0405: // NIN_BALLOONUSERCLICK
			procShowWindow.Call(hwnd, 9)
			procSetForegroundWindow.Call(hwnd)
			h.removeTray()
		case 0x0403, 0x0404: // NIN_BALLOONHIDE, NIN_BALLOONTIMEOUT
			h.removeTray()
		}
		return 0
	}
	r, _, _ := procDefWindowProcW.Call(hwnd, message, wp, lp)
	return r
}

// minimise hides and suspends the WebView: the window stays open all session, because closing it
// stops Perch, so a minimised launcher must cost next to nothing.
func (h *host) minimise() {
	if h.minimised || h.webview == nil {
		return
	}
	h.app.SetPaused(true)
	h.mu.Lock()
	h.minimised = true
	h.mu.Unlock()
	// Hidden first: TrySuspend refuses a visible WebView. Microsoft advises against also setting
	// MemoryUsageTargetLevel alongside suspension, so suspension alone does the saving.
	_ = h.chromium.Hide()
	comCall(h.webview, slotTrySuspend, uintptr(unsafe.Pointer(h.onSuspend)))
}

func (h *host) restore() {
	if !h.minimised {
		return
	}
	comCall(h.webview, slotResume)
	_ = h.chromium.Show()
	h.mu.Lock()
	h.minimised = false
	h.mu.Unlock()
	h.app.SetPaused(false)
}

// close hides the window at once and exits after `perch stop` returns.
func (h *host) close() {
	if h.closing {
		return
	}
	h.closing = true
	procShowWindow.Call(h.hwnd, 0) // SW_HIDE
	go func() {
		h.app.Close()
		h.Quit()
	}()
}

func (h *host) dispatch(f func()) {
	h.mu.Lock()
	h.queue = append(h.queue, f)
	h.mu.Unlock()
	procPostMessageW.Call(h.hwnd, wmDispatch, 0, 0)
}

func (h *host) drain() {
	h.mu.Lock()
	q := h.queue
	h.queue = nil
	h.mu.Unlock()
	for _, f := range q {
		f()
	}
}

func (h *host) onUI(f func()) {
	if windows.GetCurrentThreadId() == h.uiThread {
		f()
		return
	}
	h.dispatch(f)
}

// Eval is dropped while minimised: the page is suspended, and restoring sends the full state.
func (h *host) Eval(script string) {
	h.onUI(func() {
		h.mu.Lock()
		skip := h.minimised
		h.mu.Unlock()
		if !skip {
			h.chromium.Eval(script)
		}
	})
}

func (h *host) OpenURL(url string) error {
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		return errors.New("refusing to open " + url)
	}
	return windows.ShellExecute(windows.Handle(h.hwnd), utf16("open"), utf16(url), nil, nil, windows.SW_SHOWNORMAL)
}

func (h *host) ShowLog(text string) {
	lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
	if len(lines) > 40 {
		lines = append([]string{"…"}, lines[len(lines)-40:]...)
	}
	body := strings.Join(lines, "\r\n")
	h.dispatch(func() {
		windows.MessageBox(windows.HWND(h.hwnd), utf16(body), utf16("Perch — server log"), windows.MB_OK|windows.MB_ICONINFORMATION)
	})
}

// Notify shows a Windows notification through a notify-icon balloon, which Windows 10 and 11
// render as a toast. The icon exists only while the balloon is up.
func (h *host) Notify(title, body string) {
	h.dispatch(func() {
		h.removeTray()
		d := notifyIconData{UID: 1, Flags: 0x1 | 0x2 | 0x4 | 0x10, CallbackMessage: wmTray, InfoFlags: 0x1} // NIF_MESSAGE|NIF_ICON|NIF_TIP|NIF_INFO, NIIF_INFO
		d.Size = uint32(unsafe.Sizeof(d))
		d.Wnd = h.hwnd
		d.Icon, _, _ = procLoadImageW.Call(uintptr(moduleHandle()), uintptr(unsafe.Pointer(utf16("APP"))), 1, 16, 16, 0x8000)
		copyUTF16(d.Tip[:], "Perch — SQL Client")
		copyUTF16(d.InfoTitle[:], title)
		copyUTF16(d.Info[:], body)
		if r, _, _ := procShellNotifyIconW.Call(0, uintptr(unsafe.Pointer(&d))); r != 0 { // NIM_ADD
			h.tray = true
		}
	})
}

func (h *host) removeTray() {
	if !h.tray {
		return
	}
	d := notifyIconData{UID: 1, Wnd: h.hwnd}
	d.Size = uint32(unsafe.Sizeof(d))
	procShellNotifyIconW.Call(2, uintptr(unsafe.Pointer(&d))) // NIM_DELETE
	h.tray = false
}

// Contain puts the server in a kill-on-close job: if the launcher dies, Windows closes the job
// handle and takes the server with it.
func (h *host) Contain(p *os.Process) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.job == 0 {
		job, err := windows.CreateJobObject(nil, nil)
		if err != nil {
			return err
		}
		info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{
			BasicLimitInformation: windows.JOBOBJECT_BASIC_LIMIT_INFORMATION{LimitFlags: windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE},
		}
		if _, err := windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&info)), uint32(unsafe.Sizeof(info))); err != nil {
			windows.CloseHandle(job)
			return err
		}
		h.job = job
	}
	proc, err := windows.OpenProcess(windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE, false, uint32(p.Pid))
	if err != nil {
		return err
	}
	defer windows.CloseHandle(proc)
	return windows.AssignProcessToJobObject(h.job, proc)
}

func (h *host) Prepare(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
}

func (h *host) Quit() {
	h.dispatch(func() { procDestroyWindow.Call(h.hwnd) })
}

// comHandler is a minimal COM object for the WebView2 completion and event handler interfaces,
// all of which are IUnknown plus a two-argument Invoke.
type comHandler struct {
	vtbl *[4]uintptr
}

func newHandler(invoke func(this *comHandler, a, b unsafe.Pointer) uintptr) *comHandler {
	return &comHandler{vtbl: &[4]uintptr{
		windows.NewCallback(func(this *comHandler, _ *windows.GUID, out *unsafe.Pointer) uintptr {
			*out = unsafe.Pointer(this)
			return 0
		}),
		windows.NewCallback(func(*comHandler) uintptr { return 1 }),
		windows.NewCallback(func(*comHandler) uintptr { return 1 }),
		windows.NewCallback(invoke),
	}}
}

func comCall(obj unsafe.Pointer, slot int, args ...uintptr) uintptr {
	vtbl := *(*unsafe.Pointer)(obj)
	fn := *(*uintptr)(unsafe.Add(vtbl, slot*int(unsafe.Sizeof(uintptr(0)))))
	r, _, _ := syscall.SyscallN(fn, append([]uintptr{uintptr(obj)}, args...)...)
	return r
}

func moduleHandle() windows.Handle {
	var h windows.Handle
	_ = windows.GetModuleHandleEx(0, nil, &h)
	return h
}

// ptr reads an lParam that Windows documents as a pointer to a struct it owns.
func ptr(u uintptr) unsafe.Pointer { return *(*unsafe.Pointer)(unsafe.Pointer(&u)) }

func utf16(s string) *uint16 {
	p, _ := windows.UTF16PtrFromString(s)
	return p
}

func copyUTF16(dst []uint16, s string) {
	src, _ := windows.UTF16FromString(s)
	if len(src) > len(dst) {
		src = append(src[:len(dst)-1], 0)
	}
	copy(dst, src)
}

type wndClassEx struct {
	Size       uint32
	Style      uint32
	WndProc    uintptr
	ClsExtra   int32
	WndExtra   int32
	Instance   uintptr
	Icon       uintptr
	Cursor     uintptr
	Background uintptr
	MenuName   *uint16
	ClassName  *uint16
	IconSm     uintptr
}

type point struct{ X, Y int32 }

type rect struct{ Left, Top, Right, Bottom int32 }

type msg struct {
	Hwnd    uintptr
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      point
	Private uint32
}

type minMaxInfo struct {
	Reserved, MaxSize, MaxPosition, MinTrackSize, MaxTrackSize point
}

type notifyIconData struct {
	Size            uint32
	Wnd             uintptr
	UID             uint32
	Flags           uint32
	CallbackMessage uint32
	Icon            uintptr
	Tip             [128]uint16
	State           uint32
	StateMask       uint32
	Info            [256]uint16
	Version         uint32
	InfoTitle       [64]uint16
	InfoFlags       uint32
	GUIDItem        windows.GUID
	BalloonIcon     uintptr
}
