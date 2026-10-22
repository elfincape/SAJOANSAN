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
    static String roomTitle(String resourceId, String text, String description) {
        if (resourceId == null) return "";
        return switch (resourceId) {
            case "com.kakao.talk:id/title", "com.kakao.talk:id/chat_room_title", "com.kakao.talk:id/toolbar_title",
                 "com.kakao.talk:id/toolbar_default_title_text" -> (text == null || text.isBlank() ? description == null ? "" : description : text).trim();
            default -> "";
        };
    }
    static boolean sameSource(int sourceWindow, int currentWindow, String room, String currentRoom) {
        return sourceWindow == currentWindow && room != null && !room.isBlank() && room.equals(currentRoom);
    }
    static boolean safeName(String name) { return name != null && name.matches("[a-zA-Z0-9_-]+\\.(jpg|png|webp|json)"); }
    static String roomFolder(String room) {
        if (room == null || room.isBlank()) throw new IllegalArgumentException("대화방 이름이 필요합니다");
        String clean = room.replaceAll("[\\x00-\\x1f\\x7f\"*:<>?\\\\/|#%]", "_")
            .replaceAll("^[ .~]+|[ .]+$", "").replaceAll("(?i)_vti_", "_vti-");
        if (clean.isEmpty()) clean = "대화방";
        if (clean.matches("(?i)(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\\..*)?") || clean.equalsIgnoreCase("Forms")) clean += "_방";
        clean = clean.substring(0, clean.offsetByCodePoints(0, Math.min(80, clean.codePointCount(0, clean.length()))));
        return clean.equals(room) ? clean : clean + "_" + sha256(room.getBytes(StandardCharsets.UTF_8)).substring(0, 12);
    }
    static String remotePrefix(String observedAt, String receiptId) {
        if (!receiptId.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")) throw new IllegalArgumentException("접수번호 오류");
        return java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm-ss_SSS", java.util.Locale.ROOT)
            .withZone(java.time.ZoneId.of("Asia/Seoul")).format(java.time.Instant.parse(observedAt)) + "_" + receiptId;
    }
    static void validateRoomFolders(String configured) {
        java.util.Set<String> names = new java.util.HashSet<>();
        for (String line : configured.split("\\R")) {
            if (line.isBlank()) continue;
            String folder = java.text.Normalizer.normalize(roomFolder(line.trim()), java.text.Normalizer.Form.NFC).toLowerCase(java.util.Locale.ROOT);
            if (!names.add(folder)) throw new IllegalArgumentException("같은 OneDrive 폴더가 되는 대화방 이름이 있습니다. 대소문자·중복 이름을 확인하세요");
        }
    }
    static String remotePhotoName(String prefix, int index, String localName) {
        if (!safeName(localName) || localName.endsWith(".json") || index < 1 || index > 30) throw new IllegalArgumentException("사진 파일명 오류");
        return prefix + String.format(java.util.Locale.ROOT, "_%02d.", index) + localName.substring(localName.lastIndexOf('.') + 1);
    }
    static String sha256(byte[] bytes) {
        try { byte[] digest = MessageDigest.getInstance("SHA-256").digest(bytes); StringBuilder b = new StringBuilder();
            for (byte v : digest) b.append(String.format(java.util.Locale.ROOT, "%02x", v & 255)); return b.toString();
        } catch (Exception e) { throw new IllegalStateException(e); }
    }
    static String localKey(String room, String context, String description, int index) {
        return sha256((room + "\u0000" + context + "\u0000" + description + "\u0000" + index).getBytes(StandardCharsets.UTF_8));
    }
}
