"""Extend the pinned upstream Swift reader with a caller-bounded tail and file actions."""
import hashlib
import subprocess
import sys
import tempfile
from importlib.resources import files
from pathlib import Path

SOURCE = files("kakaotalk_native").joinpath("ReadKakaoAX.swift")
source = SOURCE.read_bytes()
if hashlib.sha256(source).hexdigest()[:20] != "8070ff42939eae750c98":
    raise SystemExit("unexpected upstream AX reader")
swift = source.decode().replace("let maximumRows = 1000", "var maximumRows = 1000")
swift = swift.replace('["windows", "read", "attachment"].contains(action)', '["windows", "read", "file", "layout"].contains(action)')
swift = swift.replace('let application = AXUIElementCreateApplication', '''
    if let session = CGSessionCopyCurrentDictionary() as? [String: Any],
       session["CGSSessionScreenIsLocked"] as? Bool == true { throw ReadFailure.blocked("screen_locked") }
    maximumRows = min(1000, max(1, request["tail"] as? Int ?? 24))
    let application = AXUIElementCreateApplication''')
swift = swift.replace('if action == "attachment" { return try attachment(request, window, found.tables[0], app.processIdentifier) }',
                      'if action == "file" { return try original(request, application, window, found.tables[0], app.processIdentifier) }')
swift = swift.replace('if action == "windows" {', 'if action == "layout" { return try layout(application, windows) }; if action == "windows" {')
swift = swift.replace("AXUIElementSetMessagingTimeout(application, 0.2)", "AXUIElementSetMessagingTimeout(application, 15.0)")
swift = swift.replace("var deadline = started + 8.0", "var deadline = started + 65.0")
# A transient menu window can disappear between enumeration and AXTitle.
swift = swift.replace('try windows.map { try string($0, "AXTitle") }',
                      'windows.compactMap { try? string($0, "AXTitle") }')
swift = swift.replace('let title = try string(window, "AXTitle")',
                      'guard let title = try? string(window, "AXTitle") else { continue }')
swift = swift.replace('try windows.filter { try string($0, "AXTitle") == titles[0] }',
                      'windows.filter { (try? string($0, "AXTitle")) == titles[0] }')
start = swift.index('func attachment(')
swift = swift[:start] + Path(__file__).with_name("Original.swift").read_text() + "\n" + swift[swift.index("func run() throws", start):]
with tempfile.TemporaryDirectory() as tmp:
    main = Path(tmp) / "main.swift"
    main.write_text(swift)
    subprocess.run(["/usr/bin/xcrun", "swiftc", "-O", str(main), "-o", sys.argv[1]], check=True)

if len(sys.argv) > 2:
    control = files("kakaotalk_native").joinpath("ControlKakaoAX.swift").read_bytes()
    if hashlib.sha256(control).hexdigest()[:20] != "b3dcd7dd6e3d12a931e0":
        raise SystemExit("unexpected upstream AX controller")
    with tempfile.TemporaryDirectory() as tmp:
        main = Path(tmp) / "main.swift"
        src = control.decode()
        src = src.replace('try setValue(field, query)\n            if names(field).contains("AXConfirm") { try act(field, "AXConfirm") }',
                          'try enterRoomSearch(field, query, app, application)')
        menu_start = src.index('        try act(cell, "AXShowMenu")')
        menu_end = src.index('        let until =', menu_start)
        src = (src[:menu_start] + '        if !(try openVisibleCell(cell, main, app, title)) {\n'
               + src[menu_start:menu_end] + '        }\n' + src[menu_end:])
        src = Path(__file__).with_name("OpenRoom.swift").read_text() + "\n" + src
        main.write_text(src.replace("started + 8.0", "started + 65.0")
                        .replace("AXUIElementSetMessagingTimeout(application, 0.2)",
                                 "AXUIElementSetMessagingTimeout(application, 15.0)")
                        .replace("systemUptime + 1.0", "systemUptime + 3.0")
                        .replace("systemUptime + 2.0", "systemUptime + 4.0"))
        subprocess.run(["/usr/bin/xcrun", "swiftc", "-O", str(main), "-o", sys.argv[2]], check=True)
