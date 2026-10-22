package kr.ianlogistics.kakaocollector;

import android.content.Context;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;

final class OneDrive {
    static final String AUTH = "https://login.microsoftonline.com/consumers/oauth2/v2.0/";
    static final String GRAPH = "https://graph.microsoft.com/v1.0";
    static final String SCOPE = "offline_access Files.ReadWrite.AppFolder";
    static final class Reply {
        final int code; final JSONObject json;
        Reply(int c, JSONObject j) { code = c; json = j; }
    }
    static String form(Map<String, String> data) {
        StringJoiner j = new StringJoiner("&"); data.forEach((k,v) -> j.add(URLEncoder.encode(k, StandardCharsets.UTF_8) + "=" + URLEncoder.encode(v, StandardCharsets.UTF_8))); return j.toString();
    }
    static Reply request(String url, String method, String token, String type, byte[] body) throws Exception {
        if (!url.startsWith(AUTH) && !url.startsWith(GRAPH + "/")) throw new IOException("허용되지 않은 접속 주소");
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(20000); c.setReadTimeout(60000); c.setInstanceFollowRedirects(false); c.setRequestMethod(method);
        if (token != null) c.setRequestProperty("Authorization", "Bearer " + token);
        if (body != null) { c.setRequestProperty("Content-Type", type); c.setDoOutput(true); c.setFixedLengthStreamingMode(body.length); try(OutputStream out = c.getOutputStream()) { out.write(body); } }
        try { int status = c.getResponseCode(); InputStream in = status < 400 ? c.getInputStream() : c.getErrorStream();
            byte[] bytes; try (InputStream source = in) { bytes = source == null ? new byte[0] : source.readNBytes(1024 * 1024); }
            return new Reply(status, bytes.length == 0 ? new JSONObject() : new JSONObject(new String(bytes, StandardCharsets.UTF_8)));
        } finally { c.disconnect(); }
    }
    static Reply oauth(String path, Map<String,String> data) throws Exception { return request(AUTH + path, "POST", null, "application/x-www-form-urlencoded", form(data).getBytes(StandardCharsets.UTF_8)); }
    static JSONObject deviceCode(String client) throws Exception {
        Reply r = oauth("devicecode", Map.of("client_id", client, "scope", SCOPE));
        if (r.code != 200) throw new IOException("Microsoft 앱 등록·개인 계정·공용 클라이언트 설정을 확인하세요 (HTTP " + r.code + ")");
        return r.json;
    }
    static void acceptTokens(Context c, JSONObject response, String oldRefresh) throws Exception {
        String refresh = response.optString("refresh_token", oldRefresh);
        if (response.optString("access_token").isEmpty() || refresh.isEmpty()) throw new IOException("오프라인 로그인 권한이 필요합니다");
        Store.saveTokens(c, new JSONObject().put("access", response.getString("access_token")).put("refresh", refresh).put("expires", System.currentTimeMillis() + response.getLong("expires_in") * 1000));
    }
    static synchronized String access(Context c) throws Exception {
        JSONObject tokens = Store.tokens(c); if (tokens == null) throw new IOException("OneDrive 로그인이 필요합니다");
        if (tokens.getLong("expires") < System.currentTimeMillis() + 60000) {
            Reply r = oauth("token", Map.of("client_id", Store.prefs(c).getString("client", ""), "grant_type", "refresh_token", "refresh_token", tokens.getString("refresh"), "scope", SCOPE));
            if (r.code != 200) throw new IOException("OneDrive 재로그인이 필요합니다 (HTTP " + r.code + ")");
            acceptTokens(c, r.json, tokens.getString("refresh")); tokens = Store.tokens(c);
        }
        return tokens.getString("access");
    }
    static JSONObject graph(String path, String method, String token, String type, byte[] body) throws Exception {
        Reply r = request(GRAPH + path, method, token, type, body);
        if (r.code < 200 || r.code >= 300) throw new IOException("OneDrive 요청 실패 (HTTP " + r.code + ")"); return r.json;
    }
    static String child(String parent, String name, String token) throws Exception {
        Reply r = request(GRAPH + "/me/drive/items/" + parent + ":/" + name, "GET", token, null, null);
        if (r.code == 200) { if (!r.json.has("folder")) throw new IOException("저장 폴더 이름 충돌"); return r.json.getString("id"); }
        if (r.code != 404) throw new IOException("OneDrive 폴더 조회 실패 (HTTP " + r.code + ")");
        byte[] body = new JSONObject().put("name", name).put("folder", new JSONObject()).put("@microsoft.graph.conflictBehavior", "fail").toString().getBytes(StandardCharsets.UTF_8);
        Reply made = request(GRAPH + "/me/drive/items/" + parent + "/children", "POST", token, "application/json", body);
        if (made.code == 409) {
            JSONObject existing = graph("/me/drive/items/" + parent + ":/" + name, "GET", token, null, null);
            if (!existing.has("folder")) throw new IOException("저장 폴더 이름 충돌"); return existing.getString("id");
        }
        if (made.code != 201) throw new IOException("OneDrive 폴더 생성 실패 (HTTP " + made.code + ")"); return made.json.getString("id");
    }
    static void upload(Context c, File directory) throws Exception {
        JSONObject receipt = Store.read(new File(directory, "receipt.json")); String id = receipt.getString("receiptId");
        if (!id.matches("[0-9a-f-]{36}")) throw new IOException("접수번호 오류");
        String token = access(c);
        JSONObject appRoot = graph("/me/drive/special/approot", "GET", token, null, null);
        String actualDrive = appRoot.getJSONObject("parentReference").getString("driveId");
        if (!actualDrive.equals(receipt.getString("driveId"))) throw new IOException("접수 당시 OneDrive 계정과 다릅니다");
        String root = appRoot.getString("id");
        String home = child(root, "KakaoIntake", token), folder = child(home, id, token);
        JSONArray photos = receipt.getJSONArray("photos");
        if ((photos.length() < 1 && !"notification".equals(receipt.optString("kind"))) || photos.length() > 30) throw new IOException("사진 개수 오류");
        for (int i = 0; i < photos.length(); i++) {
            if (!Store.enabled(c)) throw new IOException("수집 중지됨");
            JSONObject p = photos.getJSONObject(i); String name = p.getString("name"); if (!Rules.safeName(name)) throw new IOException("파일명 오류");
            File f = new File(directory, name); if (f.length() > 10 * 1024 * 1024) throw new IOException("사진당 10MB 초과");
            byte[] bytes = Files.readAllBytes(f.toPath());
            if (bytes.length != p.getLong("byteSize") || !Rules.sha256(bytes).equals(p.getString("sha256"))) throw new IOException("대기 사진 무결성 오류");
            JSONObject saved = graph("/me/drive/items/" + folder + ":/" + name + ":/content", "PUT", token, p.getString("mimeType"), bytes);
            if (saved.getLong("size") != bytes.length) throw new IOException("업로드 크기 불일치");
        }
        if (!Store.enabled(c)) throw new IOException("수집 중지됨");
        byte[] manifest = Files.readAllBytes(new File(directory, "receipt.json").toPath());
        JSONObject saved = graph("/me/drive/items/" + folder + ":/receipt.json:/content", "PUT", token, "application/json", manifest);
        if (saved.getLong("size") != manifest.length) throw new IOException("접수정보 업로드 크기 불일치");
        Store.write(new File(directory, "uploaded"), new byte[]{1});
        for (JSONObject p : photoList(photos)) { File f = new File(directory, p.getString("name")); if (!f.delete()) Store.status(c, "업로드 완료, 로컬 사진 정리 필요"); }
    }
    static List<JSONObject> photoList(JSONArray a) throws JSONException { List<JSONObject> list = new ArrayList<>(); for (int i=0;i<a.length();i++) list.add(a.getJSONObject(i)); return list; }
}
