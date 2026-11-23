// Reuse the upstream exact-name match. Activate only a hit-tested visible room label.
func openVisibleCell(_ cell: AXUIElement, _ main: AXUIElement, _ app: NSRunningApplication, _ title: String) throws -> Bool {
    guard let label = elements(cell).first(where: {
        string($0,"AXRole") == "AXStaticText" && string($0,"AXValue") == title
    }), let pos = attr(label,"AXPosition"), let size = attr(label,"AXSize") else { return false }
    var origin = CGPoint.zero, dimensions = CGSize.zero
    guard CFGetTypeID(pos) == AXValueGetTypeID(), CFGetTypeID(size) == AXValueGetTypeID(),
          AXValueGetValue(pos as! AXValue,.cgPoint,&origin), AXValueGetValue(size as! AXValue,.cgSize,&dimensions),
          dimensions.width > 0, dimensions.height > 0 else { return false }
    app.activate(options:[])
    _ = AXUIElementPerformAction(main,"AXRaise" as CFString)
    Thread.sleep(forTimeInterval:0.15)
    let point = CGPoint(x:origin.x+dimensions.width/2,y:origin.y+dimensions.height/2)
    var hit: AXUIElement?
    guard app.isActive, AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(),Float(point.x),Float(point.y),&hit) == .success,
          var item = hit else { return false }
    for _ in 0..<12 {
        if CFEqual(item,cell) {
            guard string(label,"AXValue") == title else { return false }
            for count: Int64 in [1,2] {
                for type: CGEventType in [.leftMouseDown,.leftMouseUp] {
                    guard let e = CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:point,mouseButton:.left) else {
                        throw ControlFailure.blocked("room_activation_failed")
                    }
                    e.setIntegerValueField(.mouseEventClickState,value:count)
                    e.post(tap:.cghidEventTap)
                    Thread.sleep(forTimeInterval:0.04)
                }
            }
            return true
        }
        guard let parent = attr(item,"AXParent") else { break }
        item = parent as! AXUIElement
    }
    return false
}

func enterRoomSearch(_ field: AXUIElement, _ query: String, _ app: NSRunningApplication, _ application: AXUIElement) throws {
    guard string(field,"AXRole") == "AXTextField", ["채팅방 이름, 참여자 검색", "Search chatrooms or participants"].contains(string(field,"AXPlaceholderValue")) else {
        try setValue(field,query)
        if names(field).contains("AXConfirm") { try act(field,"AXConfirm") }
        return
    }
    app.activate(options:[])
    _ = AXUIElementSetAttributeValue(field,"AXFocused" as CFString,kCFBooleanTrue)
    guard let focused = attr(application,"AXFocusedUIElement"), CFEqual(focused,field) else {
        throw ControlFailure.blocked("room_search_field_not_focused")
    }
    func key(_ code: CGKeyCode, flags: CGEventFlags = [], text: [UniChar] = []) {
        for down in [true,false] {
            let e = CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:down)
            e?.flags = flags
            if !text.isEmpty { e?.keyboardSetUnicodeString(stringLength:text.count,unicodeString:text) }
            e?.postToPid(app.processIdentifier)
        }
    }
    if !string(field,"AXValue").isEmpty {
        key(0,flags:.maskCommand)
        key(51)
    }
    if !query.isEmpty { key(0,text:Array(query.utf16)) }
    let until = min(deadline,ProcessInfo.processInfo.systemUptime+3)
    while string(field,"AXValue") != query && ProcessInfo.processInfo.systemUptime < until { Thread.sleep(forTimeInterval:0.08) }
    guard string(field,"AXValue") == query else { throw ControlFailure.blocked("room_search_input_not_observed") }
}
