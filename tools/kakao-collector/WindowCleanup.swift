// A save request gets a fresh random directory. Arm cleanup before Save only
// if no existing Finder window has that title. Keep the marker across restarts.
func finderWindows() throws -> [AXUIElement] {
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier:"com.apple.finder").first else { return [] }
    let el = AXUIElementCreateApplication(app.processIdentifier)
    return try attribute(el,"AXWindows") as? [AXUIElement] ?? []
}

func armFolderCleanup(_ directory: URL) throws {
    let windows = try finderWindows()
    for window in windows {
        if try string(window,"AXTitle") == directory.lastPathComponent { return }
    }
    try Data().write(to: directory.appendingPathComponent(".finder-pending"), options:.atomic)
}

func closePhotoFolders(_ downloads: URL) throws -> Int {
    let windows = try finderWindows()
    var named: [String:[AXUIElement]] = [:]
    for w in windows {
        let title = try string(w,"AXTitle",optional:true)
        if title.range(of:"^tmp[a-zA-Z0-9_]{8}$",options:.regularExpression) != nil {
            named[title,default:[]].append(w)
        }
    }
    var closed = 0
    for (title, matches) in named where matches.count == 1 {
        let directory = downloads.appendingPathComponent(title,isDirectory:true)
        let marker = directory.appendingPathComponent(".finder-pending")
        guard FileManager.default.fileExists(atPath:marker.path),
              FileManager.default.fileExists(atPath:directory.appendingPathComponent(".saved").path) else { continue }
        let w = matches[0]
        guard try elements(w,"AXSheets").isEmpty,
              !(try children(w)).contains(where:{ (try? string($0,"AXRole")) == "AXTabGroup" }),
              let button = try attribute(w,"AXCloseButton"), try string(w,"AXTitle") == title else { continue }
        try yieldToMacUser()
        guard AXUIElementPerformAction(button as! AXUIElement,"AXPress" as CFString) == .success else { continue }
        if try awaitValue(1,{ () -> Bool? in
            try finderWindows().contains(where:{CFEqual($0,w)}) ? nil : true
        }) != nil {
            try FileManager.default.removeItem(at:marker)
            closed += 1
        }
    }
    return closed
}

func tidyWorkspace(_ request: [String:Any]) throws -> [String:Any] {
    guard let path = request["downloads"] as? String else { throw ReadFailure.blocked("invalid_cleanup_directory") }
    var requested: [String] = []
    if request["quitApps"] as? Bool == true {
        let approved = ["com.apple.Safari", "com.apple.systempreferences"]
        let whenWindowless = ["com.apple.Preview", "com.apple.TextEdit", "com.apple.calculator"]
        for app in NSWorkspace.shared.runningApplications {
            guard let id = app.bundleIdentifier, approved.contains(id) || whenWindowless.contains(id) else { continue }
            let el = AXUIElementCreateApplication(app.processIdentifier)
            guard let windows = try? elements(el, "AXWindows"),
                  approved.contains(id) || windows.isEmpty else { continue }
            try yieldToMacUser()
            if app.terminate() { requested.append(id) }
        }
    }
    let count = try closePhotoFolders(URL(fileURLWithPath:path,isDirectory:true))
    return ["status":"ok","closedFolders":count,"quitRequested":requested]
}
