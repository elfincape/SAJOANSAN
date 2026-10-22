package kr.ianlogistics.kakaocollector;

import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.provider.MediaStore;
import java.io.*;
import java.util.*;
import org.json.*;

final class MediaFiles {
    static final class Image {
        final long id; final String signature, mime;
        Image(long i, long modified, long size, String m) { id=i; signature=i+":"+modified+":"+size; mime=m; }
    }
    static List<Image> list(Context c) {
        List<Image> images = new ArrayList<>();
        String[] columns = {"_id", "date_modified", "_size", "mime_type"};
        try(Cursor cursor = c.getContentResolver().query(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, columns, "relative_path = ? AND is_pending = 0", new String[]{"Pictures/KakaoTalk/"}, "_id ASC")) {
            if (cursor != null) while(cursor.moveToNext()) images.add(new Image(cursor.getLong(0), cursor.getLong(1), cursor.getLong(2), cursor.getString(3)));
        }
        return images;
    }
    static Set<String> snapshot(Context c) { Set<String> set = new HashSet<>(); for(Image i:list(c)) set.add(i.signature); return set; }
    static List<Image> added(Context c, Set<String> before) { List<Image> out = new ArrayList<>(); for(Image i:list(c)) if(!before.contains(i.signature)) out.add(i); return out; }
    static byte[] read(Context c, Image image) throws IOException {
        Uri uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, image.id);
        try(InputStream in = c.getContentResolver().openInputStream(uri)) {
            if(in == null) throw new IOException("사진을 읽을 수 없습니다");
            byte[] bytes = in.readNBytes(10 * 1024 * 1024 + 1);
            if(bytes.length < 12 || bytes.length > 10 * 1024 * 1024) throw new IOException("사진 크기 오류 · 10MB 이하 필요");
            boolean jpg=(bytes[0]&255)==255 && (bytes[1]&255)==216 && (bytes[2]&255)==255;
            boolean png=(bytes[0]&255)==137 && bytes[1]==80 && bytes[2]==78 && bytes[3]==71 && bytes[4]==13 && bytes[5]==10 && bytes[6]==26 && bytes[7]==10;
            boolean webp=bytes[0]==82 && bytes[1]==73 && bytes[2]==70 && bytes[3]==70 && bytes[8]==87 && bytes[9]==69 && bytes[10]==66 && bytes[11]==80;
            if (!(jpg && "image/jpeg".equals(image.mime) || png && "image/png".equals(image.mime) || webp && "image/webp".equals(image.mime))) throw new IOException("지원하지 않거나 손상된 사진");
            return bytes;
        }
    }
    static File capture(Context c, List<Image> images, JSONObject metadata, String captureKey) throws Exception {
        String id=UUID.randomUUID().toString(); File dir=new File(Store.queue(c),id); if(!dir.mkdir()) throw new IOException("접수 저장공간 오류");
        JSONArray files=new JSONArray();
        try {
        for(int i=0;i<images.size();i++) {
            Image image=images.get(i); byte[] bytes=read(c,image);
            String ext="image/png".equals(image.mime)?"png":"image/webp".equals(image.mime)?"webp":"jpg";
            String name=String.format(Locale.ROOT,"photo-%02d.%s",i+1,ext); Store.write(new File(dir,name),bytes);
            files.put(new JSONObject().put("name",name).put("mimeType",image.mime).put("byteSize",bytes.length).put("sha256",Rules.sha256(bytes))
                .put("sourceMediaId",image.id).put("sourceSignature",image.signature));
        }
        metadata.put("schemaVersion",1).put("receiptId",id).put("captureKey",captureKey).put("photos",files)
            .put("driveId",Store.prefs(c).getString("driveId",""));
        Store.write(new File(dir,"receipt.json"),metadata.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        return dir;
        } catch(Exception e) {
            File[] incomplete=dir.listFiles(); if(incomplete!=null)for(File f:incomplete)f.delete();
            dir.delete(); throw e;
        }
    }
}
