// Compiled with the pinned upstream AX tree reader (build_reader.py).
func actions(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    AXUIElementCopyActionNames(element, &names)
    return names as? [String] ?? []
}

func children(_ el: AXUIElement) throws -> [AXUIElement] { try elements(el, "AXChildren") }

func within(_ el: AXUIElement, _ ancestor: AXUIElement) -> Bool {
    var current = el
    for _ in 0..<18 {
        if CFEqual(current, ancestor) { return true }
        guard let parent = try? attribute(current, "AXParent") else { return false }
        current = parent as! AXUIElement
    }
    return false
}

func describe(_ root: AXUIElement) -> [[String:String]] {
    var out = [[String:String]]()
    func visit(_ el: AXUIElement, _ depth: Int) {
        guard depth < 9 && out.count < 100 else { return }
        let role = (try? string(el,"AXRole")) ?? ""
        if ["AXTable","AXTextArea","AXRow","AXStaticText"].contains(role) { return }
        var item = ["role":role, "id":(try? string(el,"AXIdentifier",optional:true)) ?? "",
                    "actions":actions(el).joined(separator:",")]
        if ["AXButton","AXMenuItem","AXMenuButton","AXPopUpButton","AXCheckBox"].contains(role) {
            item["title"] = (try? string(el,"AXTitle",optional:true)) ?? ""
            item["desc"] = (try? string(el,"AXDescription",optional:true)) ?? ""
        }
        out.append(item)
        for c in (try? children(el)) ?? [] { visit(c,depth+1) }
    }
    visit(root,0)
    return out
}

func clickPhoto(_ image: AXUIElement, _ row: AXUIElement, _ table: AXUIElement,
                _ window: AXUIElement, _ app: AXUIElement, _ pid: pid_t) throws {
    guard let running = NSRunningApplication(processIdentifier: pid) else { throw ReadFailure.blocked("app_not_running") }
    try yieldToMacUser()
    running.activate(options:[])
    try yieldToMacUser()
    _ = AXUIElementPerformAction(window, "AXRaise" as CFString)
    Thread.sleep(forTimeInterval:0.15)
    guard let parent = try attribute(table,"AXParent") else { throw ReadFailure.blocked("transcript_scroll_unavailable") }
    let scroll = parent as! AXUIElement
    let viewport = try frame(scroll)
    var rect = try frame(image)
    if !viewport.contains(CGPoint(x:rect.midX,y:rect.midY)),
       let bar = try attribute(scroll,"AXVerticalScrollBar"),
       let old = try attribute(bar as! AXUIElement,"AXValue") as? NSNumber,
       let first = try rows(table).items.first, let last = try rows(table).items.last {
        let height = try frame(last).maxY - frame(first).minY - viewport.height
        guard height > 0 else { throw ReadFailure.blocked("photo_offscreen") }
        let next = min(1,max(0,old.doubleValue + (rect.midY-viewport.midY)/height))
        try yieldToMacUser()
        _ = AXUIElementSetAttributeValue(bar as! AXUIElement,"AXValue" as CFString,NSNumber(value:next))
        Thread.sleep(forTimeInterval:0.15)
        rect = try frame(image)
    }
    let visible = try rect.intersection(viewport).intersection(frame(window))
    guard visible.width >= 4 && visible.height >= 4 else { throw ReadFailure.blocked("photo_outside_viewport") }
    var point: CGPoint?
    for (x,y) in [(0.5,0.5),(0.3,0.75),(0.7,0.75),(0.3,0.25),(0.7,0.25)] {
        let candidate = CGPoint(x:visible.minX+visible.width*x,y:visible.minY+visible.height*y)
        var hit: AXUIElement?
        if AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(),Float(candidate.x),Float(candidate.y),&hit) == .success,
           let target = hit, within(target,image) || (within(target,row) && within(image,target)) {
            point = candidate
            break
        }
    }
    guard let pt = point else { throw ReadFailure.blocked("photo_hit_not_confirmed") }
    let move = CGEvent(mouseEventSource:nil, mouseType:.mouseMoved, mouseCursorPosition:pt, mouseButton:.left)
    try yieldToMacUser()
    move?.post(tap:.cghidEventTap)
    Thread.sleep(forTimeInterval:0.06)
    try yieldToMacUser()
    let pair: [CGEventType] = [.leftMouseDown,.leftMouseUp]
    for type in pair {
        guard let event = CGEvent(mouseEventSource:nil,mouseType:type,mouseCursorPosition:pt,mouseButton:.left) else { throw ReadFailure.blocked("photo_open_failed") }
        event.setIntegerValueField(.mouseEventClickState,value:1)
        event.post(tap:.cghidEventTap)
        Thread.sleep(forTimeInterval:0.05)
    }
}
func original(_ req: [String: Any], _ app: AXUIElement, _ window: AXUIElement,
              _ table: AXUIElement, _ pid: pid_t) throws -> [String: Any] {
    deadline = started + 60
    let list = try rows(table)
    guard let index = req["rowIndex"] as? Int,
          let parts = req["expectedParts"] as? [[String:String]],
          let expectedCount = req["expectedCount"] as? Int, expectedCount == list.count,
          list.items.indices.contains(index - list.start) else { throw ReadFailure.blocked("attachment_snapshot_changed") }
    if let neighbors = req["neighbors"] as? [[String:Any]] {
        for neighbor in neighbors {
            guard let at = neighbor["rowIndex"] as? Int, let parts = neighbor["parts"] as? [[String:String]],
                  list.items.indices.contains(at-list.start),
                  try readRow(list.items[at-list.start],at)["parts"] as? [[String:String]] == parts else {
                throw ReadFailure.blocked("attachment_snapshot_changed")
            }
        }
    }
    let row = list.items[index - list.start]
    guard try readRow(row, index)["parts"] as? [[String:String]] == parts else {
        throw ReadFailure.blocked("attachment_snapshot_changed")
    }
    let images = try imageElements(row)
    guard let ordinal = req["ordinal"] as? Int, images.indices.contains(ordinal-1) else {
        throw ReadFailure.blocked("photo_ordinal_missing")
    }
    let image = images[ordinal-1]
    if images.count > 1 {
        let label = try string(image,"AXDescription")
        guard ["사진 "+String(ordinal)+"/"+String(images.count), "Photo "+String(ordinal)+"/"+String(images.count)].contains(label) else {
            throw ReadFailure.blocked("photo_ordinal_not_confirmed")
        }
    }
    let before = try elements(app,"AXWindows")
    func saveControl(_ w: AXUIElement) -> AXUIElement? {
        guard (try? string(w,"AXIdentifier",optional:true)) == "_NS:9" else { return nil }
        return ((try? descendants(w)) ?? []).first { el in
            ((try? string(el,"AXRole")) == "AXButton") && ((try? string(el,"AXHelp",optional:true)) ?? "").contains("저장")
        }
    }
    guard !before.contains(where:{saveControl($0) != nil}) else { throw ReadFailure.blocked("photo_viewer_already_open") }
    try clickPhoto(image,row,table,window,app,pid)
    guard let viewer = try awaitValue(8,{ () -> AXUIElement? in
        let fresh = try elements(app,"AXWindows").filter { w in !before.contains(where:{CFEqual(w,$0)}) && saveControl(w) != nil }
        return fresh.count == 1 ? fresh[0] : nil
    }), let path = req["directory"] as? String else {
        throw ReadFailure.blocked("photo_viewer_not_observed")
    }
    let directory = URL(fileURLWithPath:path,isDirectory:true)
    defer {
        // Only the viewer opened by this request belongs to the collector.
        if (try? saveSheet(app,viewer)) == nil, let close = try? attribute(viewer,"AXCloseButton"), (try? yieldToMacUser()) != nil {
            _ = AXUIElementPerformAction(close as! AXUIElement,"AXPress" as CFString)
        }
    }
    Thread.sleep(forTimeInterval:0.8)
    guard let save = try awaitValue(6, { () -> AXUIElement? in
        guard let button = saveControl(viewer), (try? attribute(button,"AXEnabled") as? Bool) != false else { return nil }
        return button
    }) else { throw ReadFailure.blocked("viewer_save_not_enabled") }
    let buttonActions = actions(save)
    AXUIElementSetMessagingTimeout(save,0.7)
    try yieldToMacUser()
    let click = AXUIElementPerformAction(save,"AXPress" as CFString)
    if images.count > 1 {
        guard let one = try awaitValue(5, { () -> AXUIElement? in
            let candidates = try descendants(viewer).filter { el in
                try string(el,"AXIdentifier",optional:true) == "saveOneForMultiPhoto:" && label(el) == "이 사진만 저장"
            }
            return candidates.count == 1 ? candidates[0] : nil
        }) else { return ["status":"ok","reason":"single_photo_menu_missing","press":click.rawValue,
                           "actions":buttonActions,"nodes":describe(viewer)] }
        try yieldToMacUser()
        _ = AXUIElementPerformAction(one,"AXPress" as CFString)
    }
    let file = try saveToDirectory(app,viewer,pid,directory)
    return ["status":"ok","filename":file]

}

func layout(_ app: AXUIElement, _ windows: [AXUIElement]) throws -> [String:Any] {
    var results = [[String:Any]]()
    for w in windows {
        let found = try? controls(w)
        let ident = try string(w,"AXIdentifier",optional:true)
        if found?.composers == 1 || ident == "Main Window" { continue }
        let title = try string(w,"AXTitle",optional:true)
        var item: [String:Any] = ["title":String(title.prefix(60)), "nodes":describe(w)]
        item["sheets"] = try elements(w,"AXSheets").map { describe($0) }
        results.append(item)
    }
    var menu = [[String:String]]()
    if let bar = try attribute(app,"AXMenuBar") {
        for entry in try children(bar as! AXUIElement) {
            for m in try children(entry) {
                for sub in try children(m) {
                    let title = try string(sub,"AXTitle",optional:true)
                    if ["저장","원본","Save","Download","다운로드"].contains(where:{ title.contains($0) }) {
                        menu.append(["title":title,"id":try string(sub,"AXIdentifier",optional:true),"enabled":String((try attribute(sub,"AXEnabled") as? Bool) ?? false)])
                    }
                }
            }
        }
    }
    return ["status":"ok","windows":results,"menus":menu]
}

func descendants(_ root: AXUIElement) throws -> [AXUIElement] {
    var found = [AXUIElement](), seen = IdentitySet()
    func visit(_ el: AXUIElement, _ depth: Int) throws {
        try checkBudget()
        guard depth < 12, seen.insert(el), found.count < 300 else { return }
        found.append(el)
        if ["AXTable", "AXOutline", "AXBrowser", "AXTextArea"].contains(try string(el,"AXRole")) { return }
        for child in try children(el) { try visit(child,depth+1) }
    }
    try visit(root,0)
    return found
}

func label(_ el: AXUIElement) -> String {
    let title = (try? string(el,"AXTitle",optional:true)) ?? ""
    return title.isEmpty ? ((try? string(el,"AXDescription",optional:true)) ?? "") : title
}

func press(_ el: AXUIElement) throws {
    guard actions(el).contains("AXPress"), (try attribute(el,"AXEnabled") as? Bool) != false else {
        throw ReadFailure.blocked("save_control_unavailable")
    }
    try yieldToMacUser()
    _ = AXUIElementPerformAction(el,"AXPress" as CFString)
}

func key(_ pid: pid_t, _ code: CGKeyCode, _ flags: CGEventFlags = []) throws {
    try yieldToMacUser()
    for down in [true,false] {
        let event = CGEvent(keyboardEventSource:nil,virtualKey:code,keyDown:down)
        event?.flags = flags
        event?.post(tap:.cghidEventTap)
    }
}

func saveSheet(_ app: AXUIElement, _ viewer: AXUIElement) throws -> AXUIElement? {
    let roots = (try elements(viewer,"AXSheets")) + (try children(viewer)).filter { el in
        (try? string(el,"AXIdentifier",optional:true)) == "save-panel"
    }
    for root in roots {
        let buttons = try descendants(root).filter { el in
            try string(el,"AXRole") == "AXButton" && (try string(el,"AXIdentifier",optional:true)) == "OKButton" && ["저장하기","저장","Save"].contains(label(el))
        }
        if buttons.count == 1 { return root }
    }
    return nil
}

func awaitValue<T>(_ seconds: Double, _ inspect: () throws -> T?) throws -> T? {
    let until = min(deadline, ProcessInfo.processInfo.systemUptime + seconds)
    repeat {
        if let value = try? inspect() { return value }
        Thread.sleep(forTimeInterval:0.12)
    } while ProcessInfo.processInfo.systemUptime < until
    return nil
}

func saveToDirectory(_ app: AXUIElement, _ viewer: AXUIElement, _ pid: pid_t, _ directory: URL) throws -> String {
    guard let panel = try awaitValue(5, { try saveSheet(app, viewer) }) else { throw ReadFailure.blocked("save_panel_not_observed") }
    guard let running = NSRunningApplication(processIdentifier:pid) else { throw ReadFailure.blocked("app_not_running") }
    try yieldToMacUser()
    running.activate(options:[])
    try yieldToMacUser()
    _ = AXUIElementPerformAction(viewer,"AXRaise" as CFString)
    guard try awaitValue(3,{ () -> Bool? in
        guard running.isActive, let focused = try attribute(app,"AXFocusedUIElement"),
              within(focused as! AXUIElement,panel) else { return nil }
        return true
    }) != nil else { throw ReadFailure.blocked("save_panel_focus_changed") }
    try key(pid,5,[.maskCommand,.maskShift])
    guard let field = try awaitValue(6, { () -> AXUIElement? in
        guard let raw = try attribute(app,"AXFocusedUIElement") else { return nil }
        let el = raw as! AXUIElement
        guard try string(el,"AXIdentifier",optional:true) == "PathTextField", within(el,panel) else { return nil }
        return el
    }) else { throw ReadFailure.blocked("folder_field_not_observed") }
    try yieldToMacUser()
    guard AXUIElementSetAttributeValue(field,"AXValue" as CFString,directory.path as CFString) == .success,
          try string(field,"AXValue") == directory.path, running.isActive else { throw ReadFailure.blocked("save_folder_not_set") }
    Thread.sleep(forTimeInterval:0.35)
    try key(pid,36)
    let folderName = directory.lastPathComponent
    guard let saveButton = try awaitValue(4, { () -> AXUIElement? in
        let entries = try descendants(panel)
        guard entries.contains(where:{ el in
            let value = (try? string(el,"AXValue",optional:true)) ?? ""
            return [value,label(el)].contains(folderName) || (try? attribute(el,"AXURL") as? URL)?.standardizedFileURL == directory.standardizedFileURL
        }) else { return nil }
        let buttons = entries.filter { ((try? string($0,"AXIdentifier",optional:true)) == "OKButton") && ["저장하기","저장","Save"].contains(label($0)) && actions($0).contains("AXPress") }
        return buttons.count == 1 ? buttons[0] : nil
    }) else { throw ReadFailure.blocked("save_folder_not_confirmed") }
    // A private directory is bound to one attachment before any Save action.
    // Finder cleanup is optional and independent of saving the original file.
    try? armFolderCleanup(directory)
    try "save".write(to:directory.appendingPathComponent(".requested"),atomically:true,encoding:.utf8)
    try press(saveButton)
    guard let file = try awaitValue(10, { () -> URL? in
        if try saveSheet(app,viewer) != nil { return nil }
        let files = try FileManager.default.contentsOfDirectory(at:directory,includingPropertiesForKeys:[.isRegularFileKey],options:.skipsHiddenFiles)
        return files.count == 1 ? files[0] : nil
    }) else { throw ReadFailure.blocked("download_not_observed") }
    try file.lastPathComponent.write(to:directory.appendingPathComponent(".saved"),atomically:true,encoding:.utf8)
    return file.lastPathComponent
}
