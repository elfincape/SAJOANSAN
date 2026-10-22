package kr.ianlogistics.kakaocollector;

import android.content.*;
import android.security.keystore.*;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.KeyStore;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

final class Store {
    static android.content.SharedPreferences prefs(Context c) { return c.getSharedPreferences("collector", 0); }
    static boolean enabled(Context c) { return prefs(c).getBoolean("enabled", false); }
    static void status(Context c, String message) { prefs(c).edit().putString("status", message).apply(); }
    static void photoStatus(Context c, String message) {
        if (!message.equals(prefs(c).getString("photoStatus", ""))) prefs(c).edit().putString("photoStatus", message).apply();
    }
    static void uploadStatus(Context c, String message) { prefs(c).edit().putString("uploadStatus", message).apply(); }
    static void cleanupStatus(Context c,String message) { prefs(c).edit().putString("cleanupStatus",message).apply(); }
    static String details(Context c) {
        String detail = prefs(c).getString("status", "설정 후 테스트 방에서 확인하세요");
        String photo = prefs(c).getString("photoStatus", "");
        String upload = prefs(c).getString("uploadStatus", "");
        if (!photo.isEmpty()) detail += "\n사진 수집: " + photo;
        if (!upload.isEmpty()) detail += "\n전송: " + upload;
        String cleanup=prefs(c).getString("cleanupStatus", "");
        if(!cleanup.isEmpty())detail+="\n사진 정리: "+cleanup;
        return detail;
    }
    static File queue(Context c) { File d = new File(c.getFilesDir(), "queue"); d.mkdirs(); return d; }
    static File[] pending(Context c) { File[] a = queue(c).listFiles(f -> f.isDirectory() && new File(f, "receipt.json").isFile() && !new File(f, "uploaded").exists()); return a == null ? new File[0] : a; }
    static void write(File file, byte[] bytes) throws IOException {
        File temp = new File(file.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(temp)) { out.write(bytes); out.getFD().sync(); }
        if (!temp.renameTo(file)) throw new IOException("로컬 저장 실패");
    }
    static JSONObject read(File f) throws Exception { return new JSONObject(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8)); }
    static javax.crypto.SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if (!ks.containsAlias("onedrive")) { KeyGenerator g = KeyGenerator.getInstance("AES", "AndroidKeyStore");
            g.init(new KeyGenParameterSpec.Builder("onedrive", KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build()); g.generateKey(); }
        return (javax.crypto.SecretKey) ks.getKey("onedrive", null);
    }
    static synchronized void saveTokens(Context c, JSONObject tokens) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        String sealed = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + "." + Base64.encodeToString(cipher.doFinal(tokens.toString().getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP);
        if (!prefs(c).edit().putString("tokens", sealed).commit()) throw new IOException("인증 정보 저장 실패");
    }
    static synchronized JSONObject tokens(Context c) throws Exception {
        String sealed = prefs(c).getString("tokens", ""); if (sealed.isEmpty()) return null;
        String[] parts = sealed.split("\\."); Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new JSONObject(new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8));
    }
    static boolean connected(Context c) { return !prefs(c).getString("tokens", "").isEmpty(); }
}
