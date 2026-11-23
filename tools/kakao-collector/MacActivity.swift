// Both bridges run one request per process. Read only the physical HID idle
// counter; no keyboard events, cursor positions or application names are stored.
import IOKit
import Foundation

var idleGuardSeconds: Double = 0
private let hidSystem = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOHIDSystem"))

func hardwareIdleSeconds() throws -> Double {
    guard hidSystem != 0,
          let value = IORegistryEntryCreateCFProperty(hidSystem, "HIDIdleTime" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? NSNumber else {
        throw BridgeFailure.blocked("mac_input_unavailable")
    }
    return value.doubleValue / 1_000_000_000
}

func yieldToMacUser() throws {
    if idleGuardSeconds > 0, try hardwareIdleSeconds() < idleGuardSeconds {
        throw BridgeFailure.blocked("mac_user_active")
    }
}
