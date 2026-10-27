package kr.ianlogistics.kakaocollector;

import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.*;
import java.util.function.BooleanSupplier;

final class MmsScreenFiles {
    private static final String VOLUME=MediaStore.VOLUME_EXTERNAL_PRIMARY;
    private static final Uri IMAGES=MediaStore.Images.Media.getContentUri(VOLUME);
    static final class Snapshot {
        final Set<Long> ids;final long generation;final String version;
        Snapshot(Set<Long> ids,long generation,String version){this.ids=ids;this.generation=generation;this.version=version;}
    }
    static final class Image {
        final long id,generation;final String signature,mime;
        Image(long id,long modified,long size,String mime,long generation){this.id=id;this.generation=generation;signature=id+":"+modified+":"+size;this.mime=mime;}
    }
    static List<Image> images(Context c) throws IOException {
        List<Image> result=new ArrayList<>();
        try(Cursor rows=MmsSource.query(c,IMAGES,new String[]{"_id","date_modified","_size","mime_type","generation_added"},"relative_path = ? AND owner_package_name = ? AND is_pending = 0",new String[]{"Download/",MmsScreenAccess.PACKAGE},"_id ASC")) {
            while(rows.moveToNext())result.add(new Image(rows.getLong(0),rows.getLong(1),rows.getLong(2),rows.getString(3),rows.getLong(4)));
        }
        return result;
    }
    static Snapshot snapshot(Context c) throws IOException {
        String version=MediaStore.getVersion(c,VOLUME);Set<Long> ids=new HashSet<>();
        try(Cursor rows=MmsSource.query(c,IMAGES,new String[]{"_id"},"relative_path = ? AND owner_package_name = ?",new String[]{"Download/",MmsScreenAccess.PACKAGE},null)){while(rows.moveToNext())ids.add(rows.getLong(0));}
        return new Snapshot(ids,MediaStore.getGeneration(c,VOLUME),version);
    }
    static List<Image> added(Context c,Snapshot before) throws IOException {
        if(before.version==null||!before.version.equals(MediaStore.getVersion(c,VOLUME)))throw new IOException("미디어 저장소가 변경되어 사진 연결 중단");
        List<Image> r=new ArrayList<>();for(Image i:images(c))if(!before.ids.contains(i.id)&&i.generation>before.generation)r.add(i);return r;
    }
    static byte[] read(Context c,Image image) throws IOException {
        try(InputStream in=c.getContentResolver().openInputStream(ContentUris.withAppendedId(IMAGES,image.id))) {
            if(in==null)throw new IOException("삼성 메시지 저장 사진을 읽을 수 없습니다");
            return in.readNBytes(10*1024*1024+1);
        }
    }
    static File capture(Context c,Image image,String sender,LocalDateTime date) throws Exception {
        byte[] bytes=read(c,image);String ext=MmsRules.extension(image.mime,bytes),hash=Rules.sha256(bytes);
        long time=date.atZone(MmsRules.KST).toEpochSecond();String drive=Store.prefs(c).getString("driveId","");
        if(drive.isEmpty())throw new IOException("OneDrive 연결 확인 필요");
        String id=MmsRules.receiptId(drive,0,time,sender,"samsung_screen\n"+hash);File dir=new File(Store.queue(c),id);
        if(new File(dir,"receipt.json").isFile())return dir;
        if(!dir.mkdir())throw new IOException("사진 접수 저장공간 오류");
        try {
            String name="photo-01."+ext;Store.write(new File(dir,name),bytes);
            JSONObject photo=new JSONObject().put("name",name).put("mimeType",image.mime).put("byteSize",bytes.length).put("sha256",hash);
            JSONObject receipt=new JSONObject().put("schemaVersion",1).put("receiptId",id).put("kind","mms").put("source","samsung_screen")
                .put("room",sender).put("mmsReceivedSeconds",time).put("observedAt",date.atZone(MmsRules.KST).toInstant().toString())
                .put("driveId",drive).put("screenMediaId",image.id).put("screenGeneration",image.generation).put("screenSignature",image.signature).put("photos",new JSONArray().put(photo));
            Store.write(new File(dir,"receipt.json"),receipt.toString(2).getBytes(StandardCharsets.UTF_8));return dir;
        }catch(Exception e){File[] files=dir.listFiles();if(files!=null)for(File f:files)f.delete();dir.delete();throw e;}
    }
    static void cleanup(Context c,File dir,Image image,BooleanSupplier running) throws Exception {
        if(!running.getAsBoolean()||!new File(dir,"uploaded").isFile())return;
        if(!MediaStore.canManageMedia(c)){Store.cleanupStatus(c,"삭제 권한 없음 · 새 Download 저장본은 유지합니다");return;}
        JSONObject receipt=Store.read(new File(dir,"receipt.json"));
        OneDrive.verifyPhotoBackups(c,receipt);
        Image current=null;for(Image i:images(c))if(i.id==image.id)current=i;
        if(current==null)return;
        if(image.generation!=current.generation||!image.signature.equals(current.signature)||!receipt.getJSONArray("photos").getJSONObject(0).getString("sha256").equals(Rules.sha256(read(c,current)))) {
            Store.cleanupStatus(c,"저장본 변경 감지 · 삭제 보류");return;
        }
        if(!running.getAsBoolean())return;
        PendingIntent request=MediaStore.createDeleteRequest(c.getContentResolver(),List.of(ContentUris.withAppendedId(IMAGES,image.id)));
        android.os.Bundle options=Build.VERSION.SDK_INT>=34?ActivityOptions.makeBasic().setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED).toBundle():null;
        request.send(c,0,null,null,null,null,options);Store.cleanupStatus(c,"OneDrive 확인 후 새 Download 저장본 삭제 요청");
    }
    static void retry(Context c,String sender,long start,long end,BooleanSupplier running) throws Exception {
        for(File dir:Store.pending(c)) {
            MmsSource.active(running);JSONObject r=Store.read(new File(dir,"receipt.json"));long date=r.optLong("mmsReceivedSeconds",-1);
            if("samsung_screen".equals(r.optString("source"))&&sender.equals(r.optString("room"))&&date>=start&&date<end) {
                OneDrive.upload(c,dir,running);
                for(Image i:images(c))if(i.id==r.optLong("screenMediaId")&&i.generation==r.optLong("screenGeneration")&&i.signature.equals(r.optString("screenSignature")))try{cleanup(c,dir,i,running);}catch(Exception e){Store.cleanupStatus(c,"Download 저장본 유지 · "+e.getMessage());}
            }
        }
    }
}
