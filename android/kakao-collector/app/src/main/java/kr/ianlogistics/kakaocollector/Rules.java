package kr.ianlogistics.kakaocollector;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.regex.*;

final class Rules {
    static int photoCount(String description) {
        if ("사진".equals(description)) return 1;
        Matcher m = Pattern.compile("^사진,\\s*(\\d+)/(\\d+)$").matcher(description);
        if (!m.matches()) return 0;
        try { int index = Integer.parseInt(m.group(1)), count = Integer.parseInt(m.group(2));
            return index == 1 && count >= 1 && count <= 30 ? count : 0;
        } catch (NumberFormatException e) { return 0; }
    }
    static boolean allowedRoom(String room, String configured) {
        if (room == null || room.isBlank()) return false;
        return configured.lines().map(String::trim).anyMatch(room::equals);
    }
    static boolean sameSource(int sourceWindow, int currentWindow, String room, String currentRoom) {
        return sourceWindow == currentWindow && room != null && !room.isBlank() && room.equals(currentRoom);
    }
    static boolean safeName(String name) { return name != null && name.matches("[a-zA-Z0-9_-]+\\.(jpg|png|webp|json)"); }
    static String sha256(byte[] bytes) {
        try { byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes); StringBuilder b = new StringBuilder();
            for (byte v : digest) b.append(String.format(java.util.Locale.ROOT, "%02x", v & 255)); return b.toString();
        } catch (Exception e) { throw new IllegalStateException(e); }
    }
    static String localKey(String room, String context, String description, int index) {
        return sha256((room + "\u0000" + context + "\u0000" + description + "\u0000" + index).getBytes(StandardCharsets.UTF_8));
    }
}
