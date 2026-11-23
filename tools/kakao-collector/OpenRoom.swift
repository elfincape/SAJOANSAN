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
    if query.isEmpty { try clearRoomSearch(field); return }
    app.activate(options:[])
    _ = AXUIElementPerformAction(try mainWindow(application), "AXRaise" as CFString)
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

// The chat list's own cancel button works even with an open chat in front.
func clearRoomSearch(_ field: AXUIElement) throws {
    guard let value = attr(field, "AXValue") as? String else { throw ControlFailure.blocked("room_picker_filter_active") }
    if value.isEmpty { return }
    let cancel = elements(field).filter {
        string($0, "AXRole") == "AXButton" && ["취소", "Cancel"].contains(string($0, "AXDescription"))
    }
    guard cancel.count == 1 else { throw ControlFailure.blocked("room_picker_filter_active") }
    try act(cancel[0], "AXPress")
    Thread.sleep(forTimeInterval: 0.65)
}

func pickerFields(_ controls: [AXUIElement]) -> [AXUIElement] {
    controls.filter { ["AXTextField", "AXSearchField"].contains(string($0, "AXRole")) }
}

// A single AX round trip gets the metadata needed to find self badges, even
// when Kakao nests the badge in a child view. Only read the first room label.
func pickerLabel(_ element: AXUIElement, _ direct: Bool, _ depth: Int, _ name: inout String?, _ own: inout Bool) throws {
    try check()
    guard depth < 20 else { throw ControlFailure.blocked("accessibility_tree_depth") }
    var values: CFArray?
    let keys = ["AXRole", "AXDescription", "AXChildren"] as CFArray
    guard AXUIElementCopyMultipleAttributeValues(element, keys, [], &values) == .success,
          let metadata = values as? [Any], metadata.count == 3, let role = metadata[0] as? String else {
        throw ControlFailure.blocked("room_picker_changed")
    }
    if direct, role == "AXStaticText", name == nil { name = string(element, "AXValue") }
    if role == "AXImage", metadata[1] as? String == "badge me" { own = true }
    if ["AXTextArea", "AXTextField", "AXSearchField"].contains(role) { return }
    for child in metadata[2] as? [AXUIElement] ?? [] {
        try pickerLabel(child, false, depth + 1, &name, &own)
    }
}

func pickerRooms(_ main: AXUIElement) throws -> [String: Any] {
    var controls = try nodes(main)
    let fields = pickerFields(controls)
    for field in fields {
        guard let value = attr(field, "AXValue") as? String else { throw ControlFailure.blocked("room_picker_filter_active") }
        if value.isEmpty { continue }
        guard ["채팅방 이름, 참여자 검색", "Search chatrooms or participants"].contains(string(field, "AXPlaceholderValue")) else {
            throw ControlFailure.blocked("room_picker_filter_active")
        }
        try clearRoomSearch(field)
        controls = try nodes(main)
    }
    func isUnfiltered(_ controls: [AXUIElement]) -> Bool {
        pickerFields(controls).allSatisfy { (attr($0, "AXValue") as? String) == "" }
    }
    guard isUnfiltered(controls) else { throw ControlFailure.blocked("room_picker_filter_active") }
    let tables = controls.filter { string($0, "AXRole") == "AXTable" }
    guard tables.count == 1, let rows = attr(tables[0], "AXRows") as? [AXUIElement] else {
        throw ControlFailure.blocked("room_list_not_unique")
    }
    var items: [[String: Any]] = []
    for row in rows {
        try check()
        let cells = elements(row)
        guard cells.count == 1, string(cells[0], "AXRole") == "AXCell" else { continue }
        var name: String?
        var own = false
        for child in elements(cells[0]) {
            try pickerLabel(child, true, 0, &name, &own)
        }
        if let name = name, !name.isEmpty { items.append(["name": name, "isSelf": own]) }
    }
    var reported = 0
    guard AXUIElementGetAttributeValueCount(tables[0], "AXRows" as CFString, &reported) == .success,
          reported == rows.count, isUnfiltered(try nodes(main)) else { throw ControlFailure.blocked("room_picker_changed") }
    return ["status": "ok", "items": items, "reportedRowCount": reported, "rowsSource": "AXRows", "searchQuery": ""]
}
