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
    static final String SCOPE = "offline_access Files.ReadWrite";
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
        try {
            if (body != null) { c.setRequestProperty("Content-Type", type); c.setDoOutput(true); c.setFixedLengthStreamingMode(body.length); try(OutputStream out = c.getOutputStream()) { out.write(body); } }
            int status = c.getResponseCode(); InputStream in = status < 400 ? c.getInputStream() : c.getErrorStream();
            byte[] bytes; try (InputStream source = in) { bytes = source == null ? new byte[0] : source.readNBytes(1024 * 1024); }
            try { return new Reply(status, bytes.length == 0 ? new JSONObject() : new JSONObject(new String(bytes, StandardCharsets.UTF_8))); }
            catch (JSONException invalid) {
                if (status < 200 || status >= 300) throw new HttpFailure(status);
                throw new IOException("Microsoft 서버 응답 형식을 확인하지 못했습니다");
            }
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
        Store.saveTokens(c, new JSONObject().put("access", response.getString("access_token")).put("refresh", refresh).put("scope", response.optString("scope")).put("expires", System.currentTimeMillis() + response.getLong("expires_in") * 1000));
    }
    static synchronized String access(Context c) throws Exception {
        JSONObject tokens = Store.tokens(c); if (tokens == null) throw new IOException("OneDrive 로그인이 필요합니다");
        if (!Arrays.asList(tokens.optString("scope").toLowerCase(Locale.ROOT).split("\\s+")).contains("files.readwrite")) throw new IOException("저장 폴더가 변경되었습니다. OneDrive에 다시 로그인해 주세요");
        if (tokens.getLong("expires") < System.currentTimeMillis() + 60000) {
            Reply r = oauth("token", Map.of("client_id", Store.prefs(c).getString("client", ""), "grant_type", "refresh_token", "refresh_token", tokens.getString("refresh"), "scope", SCOPE));
            if (r.code != 200) throw new IOException("OneDrive 재로그인이 필요합니다 (HTTP " + r.code + ")");
            acceptTokens(c, r.json, tokens.getString("refresh")); tokens = Store.tokens(c);
        }
        return tokens.getString("access");
    }
    static JSONObject graph(String path, String method, String token, String type, byte[] body) throws Exception {
        Reply r = request(GRAPH + path, method, token, type, body);
        if (r.code < 200 || r.code >= 300) throw new HttpFailure(r.code); return r.json;
    }
    static final class HttpFailure extends IOException {
        final int status;
        HttpFailure(int status) { super("OneDrive 요청 실패 (HTTP " + status + ")"); this.status = status; }
    }
    interface Pauser { void pause(long milliseconds) throws InterruptedException; }
    static boolean retryable(Exception error) {
        return error instanceof UnknownHostException || error instanceof SocketTimeoutException || error instanceof ConnectException
            || error instanceof NoRouteToHostException || error instanceof SocketException || error instanceof EOFException
            || error instanceof HttpFailure && (((HttpFailure) error).status == 408 || ((HttpFailure) error).status == 429 || ((HttpFailure) error).status >= 500);
    }
    static void completeDeviceLogin(Context c, String client, JSONObject code, java.util.function.BooleanSupplier active,
                                    java.util.function.LongSupplier now, Pauser wait) throws Exception {
        long end = now.getAsLong() + code.getLong("expires_in") * 1000;
        long interval = Math.max(5, code.optInt("interval", 5));
        JSONObject issued = null;
        Store.status(c, "브라우저 로그인 대기 · 완료 후 수집 앱으로 돌아오세요");
        while (active.getAsBoolean() && now.getAsLong() < end) {
            wait.pause(interval * 1000);
            if (!active.getAsBoolean() || now.getAsLong() >= end) break;
            try {
                if (issued == null) {
                    Reply reply = oauth("token", Map.of("client_id", client, "grant_type", "urn:ietf:params:oauth:grant-type:device_code", "device_code", code.getString("device_code")));
                    if (reply.code == 200) { issued = reply.json; end = Math.max(end, now.getAsLong() + 120000); }
                    else {
                        String error = reply.json.optString("error");
                        if ("slow_down".equals(error)) { interval += 5; continue; }
                        if ("authorization_pending".equals(error)) continue;
                        if (reply.code == 408 || reply.code == 429 || reply.code >= 500) throw new HttpFailure(reply.code);
                        throw new IOException("Microsoft 로그인 실패 · " + error);
                    }
                }
                String driveId = graph("/me/drive?$select=id", "GET", issued.getString("access_token"), null, null).getString("id");
                String existing = Store.prefs(c).getString("driveId", "");
                if (!existing.isEmpty() && !existing.equals(driveId)) throw new IOException("기존 수집 계정과 다른 OneDrive입니다. 기존 계정으로 로그인하세요");
                acceptTokens(c, issued, "");
                Store.prefs(c).edit().putString("driveId", driveId).apply();
                Store.status(c, "OneDrive 로그인 완료");
                return;
            } catch (Exception error) {
                if (!retryable(error)) throw error;
                interval = Math.max(5, interval);
                Store.status(c, "Microsoft 연결 재시도 중 · 브라우저에서 완료했다면 수집 앱으로 돌아와 기다려 주세요");
            }
        }
        throw new IOException("로그인 확인 시간이 지났습니다. 인터넷 연결 후 다시 로그인해 주세요");
    }
    static String child(String parent, String name, String token) throws Exception {
        String path = "/me/drive/items/" + segment(parent) + ":/" + segment(name);
        Reply r = request(GRAPH + path, "GET", token, null, null);
        if (r.code == 200) { if (!r.json.has("folder")) throw new IOException("저장 폴더 이름 충돌"); return r.json.getString("id"); }
        if (r.code != 404) throw new IOException("OneDrive 폴더 조회 실패 (HTTP " + r.code + ")");
        byte[] body = new JSONObject().put("name", name).put("folder", new JSONObject()).put("@microsoft.graph.conflictBehavior", "fail").toString().getBytes(StandardCharsets.UTF_8);
        Reply made = request(GRAPH + "/me/drive/items/" + segment(parent) + "/children", "POST", token, "application/json", body);
        if (made.code == 409) {
            JSONObject existing = graph(path, "GET", token, null, null);
            if (!existing.has("folder")) throw new IOException("저장 폴더 이름 충돌"); return existing.getString("id");
        }
        if (made.code != 201) throw new IOException("OneDrive 폴더 생성 실패 (HTTP " + made.code + ")"); return made.json.getString("id");
    }
    static String segment(String value) { return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20"); }
    static String rawText(JSONObject receipt) {
        StringBuilder body = new StringBuilder();
        if ("notification".equals(receipt.optString("kind"))) {
            JSONArray messages = receipt.optJSONArray("messages");
            if (messages != null) for (int i = 0; i < messages.length(); i++) {
                JSONObject message = messages.optJSONObject(i);
                if (message == null || message.optString("text").isBlank()) continue;
                if (!message.isNull("sender") && !message.optString("sender").isBlank()) body.append(message.optString("sender")).append(": ");
                body.append(message.optString("text")).append('\n');
            }
            if (body.length() == 0) body.append(receipt.optString("notificationText"));
        } else body.append(receipt.optString("visibleContext"));
        if (body.toString().isBlank()) return "";
        return "대화방: " + receipt.optString("room") + "\n수집 시각: " + receipt.optString("observedAt") + "\n\n" + body;
    }
    static void verifyPhotoBackups(Context c,JSONObject receipt) throws Exception {
        String token=access(c);
        if(!receipt.getString("driveId").equals(graph("/me/drive?$select=id","GET",token,null,null).getString("id")))throw new IOException("사진 전송 계정이 달라 폰 사진 유지");
        String prefix=Rules.remotePrefix(receipt.getString("observedAt"),receipt.getString("receiptId"));
        String base="/me/drive/root:/"+segment("이안카카오")+"/"+segment(Rules.roomFolder(receipt.getString("room")))+"/";
        JSONArray photos=receipt.getJSONArray("photos");
        for(int i=0;i<photos.length();i++) {
            JSONObject photo=photos.getJSONObject(i);
            JSONObject saved=graph(base+segment(Rules.remotePhotoName(prefix,i+1,photo.getString("name")))+"?$select=size,file","GET",token,null,null);
            if(!saved.has("file")||saved.getLong("size")!=photo.getLong("byteSize"))throw new IOException("OneDrive 사진 보관 확인 실패 · 폰 사진 유지");
            JSONObject hashes=saved.getJSONObject("file").optJSONObject("hashes");
            String digest=hashes==null?"":hashes.optString("sha256Hash");
            if(!digest.isEmpty()&&!digest.equalsIgnoreCase(photo.getString("sha256")))throw new IOException("OneDrive 사진 해시 불일치 · 폰 사진 유지");
        }
    }
    static void upload(Context c, File directory) throws Exception {
        upload(c,directory,()->Store.enabled(c));
    }
    static void upload(Context c, File directory, java.util.function.BooleanSupplier active) throws Exception {
        if(!active.getAsBoolean())throw new IOException("수집 중지됨");
        JSONObject receipt = Store.read(new File(directory, "receipt.json")); String id = receipt.getString("receiptId");
        if (!id.matches("[0-9a-f-]{36}")) throw new IOException("접수번호 오류");
        JSONArray photos = receipt.getJSONArray("photos");
        String text = rawText(receipt);
        if (photos.length() == 0 && "notification".equals(receipt.optString("kind")) && text.isEmpty()) {
            Store.write(new File(directory, "uploaded"), new byte[]{1});
            return;
        }
        String token = access(c);
        String actualDrive = graph("/me/drive?$select=id", "GET", token, null, null).getString("id");
        if (!actualDrive.equals(receipt.getString("driveId"))) throw new IOException("접수 당시 OneDrive 계정과 다릅니다");
        String root = graph("/me/drive/root?$select=id", "GET", token, null, null).getString("id");
        String room = Rules.roomFolder(receipt.getString("room"));
        String prefix = Rules.remotePrefix(receipt.getString("observedAt"), id);
        String home = child(root, "이안카카오", token);
        if ("mms".equals(receipt.optString("kind"))) home=child(home,"문자",token);
        String folder = child(home, room, token);
        if ((photos.length() < 1 && !"notification".equals(receipt.optString("kind"))) || photos.length() > 30) throw new IOException("사진 개수 오류");
        for (int i = 0; i < photos.length(); i++) {
            if (!active.getAsBoolean()) throw new IOException("수집 중지됨");
            JSONObject p = photos.getJSONObject(i); String name = p.getString("name"); if (!Rules.safeName(name)) throw new IOException("파일명 오류");
            String remoteName = Rules.remotePhotoName(prefix, i + 1, name);
            File f = new File(directory, name); if (f.length() > 10 * 1024 * 1024) throw new IOException("사진당 10MB 초과");
            byte[] bytes = Files.readAllBytes(f.toPath());
            if (bytes.length != p.getLong("byteSize") || !Rules.sha256(bytes).equals(p.getString("sha256"))) throw new IOException("대기 사진 무결성 오류");
            JSONObject saved = graph("/me/drive/items/" + segment(folder) + ":/" + segment(remoteName) + ":/content", "PUT", token, p.getString("mimeType"), bytes);
            if (saved.getLong("size") != bytes.length) throw new IOException("업로드 크기 불일치");
        }
        if (!active.getAsBoolean()) throw new IOException("수집 중지됨");
        if (!text.isEmpty()) {
            byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
            JSONObject saved = graph("/me/drive/items/" + segment(folder) + ":/" + segment(prefix + "_대화.txt") + ":/content", "PUT", token, "text/plain; charset=utf-8", bytes);
            if (saved.getLong("size") != bytes.length) throw new IOException("텍스트 업로드 크기 불일치");
        } else if (photos.length() == 0) throw new IOException("저장할 사진·텍스트가 없습니다");
        Store.write(new File(directory, "uploaded"), new byte[]{1});
        for (JSONObject p : photoList(photos)) { File f = new File(directory, p.getString("name")); if (!f.delete()) Store.status(c, "업로드 완료, 로컬 사진 정리 필요"); }
    }
    static List<JSONObject> photoList(JSONArray a) throws JSONException { List<JSONObject> list = new ArrayList<>(); for (int i=0;i<a.length();i++) list.add(a.getJSONObject(i)); return list; }
}
