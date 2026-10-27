package kr.ianlogistics.kakaocollector;

import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import java.io.*;
import java.util.*;
import java.util.function.BooleanSupplier;
import org.json.*;

final class MmsSavedFiles {
    private static final Uri FILES=MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
    static final class Snapshot {
        final Set<Long> ids;final String version;
        Snapshot(Set<Long> ids,String version){this.ids=ids;this.version=version;}
    }
    static final class Image {
        final long id;final String signature,mime,version;
        Image(long id,long generation,long size,long modified,String mime,String version){this.id=id;this.signature=id+":"+generation+":"+size+":"+modified;this.mime=mime;this.version=version;}
        Uri uri(){return ContentUris.withAppendedId(FILES,id);}
    }
    static List<Image> images(Context c) throws IOException {
        List<Image> result=new ArrayList<>();String version=MediaStore.getVersion(c,MediaStore.VOLUME_EXTERNAL_PRIMARY);
        try(Cursor rows=MmsSource.query(c,FILES,new String[]{"_id","generation_added","_size","date_modified","mime_type"},"relative_path = ? AND owner_package_name = ? AND media_type = 1 AND is_pending = 0",new String[]{"Download/",MmsScreenAccess.PACKAGE},"_id ASC")){
            while(rows.moveToNext())result.add(new Image(rows.getLong(0),rows.getLong(1),rows.getLong(2),rows.getLong(3),rows.getString(4),version));
        }return result;
    }
    static Snapshot snapshot(Context c) throws IOException {
        String version=MediaStore.getVersion(c,MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Set<Long> ids=new HashSet<>();
        try(Cursor rows=MmsSource.query(c,FILES,new String[]{"_id"},"relative_path = ? AND owner_package_name = ?",new String[]{"Download/",MmsScreenAccess.PACKAGE},null)){while(rows.moveToNext())ids.add(rows.getLong(0));}
        if(version==null||!version.equals(MediaStore.getVersion(c,MediaStore.VOLUME_EXTERNAL_PRIMARY)))throw new IOException("미디어 저장소 변경 · 저장 중단");
        return new Snapshot(ids,version);
    }
    static Image added(Context c,Snapshot before) throws IOException {
        if(!before.version.equals(MediaStore.getVersion(c,MediaStore.VOLUME_EXTERNAL_PRIMARY)))throw new IOException("미디어 저장소 변경 · 새 저장본은 유지합니다");
        Image added=null;for(Image i:images(c)){if(!before.version.equals(i.version))throw new IOException("미디어 저장소 변경 · 연결 중단");if(!before.ids.contains(i.id)){if(added!=null)throw new IOException("새 저장 사진이 여러 장이라 연결을 중단합니다. 저장본은 유지합니다");added=i;}}return added;
    }
    static void remember(Context c,File dir,Image image) throws Exception {
        if(!image.version.equals(MediaStore.getVersion(c,MediaStore.VOLUME_EXTERNAL_PRIMARY)))throw new IOException("미디어 저장소 변경 · 저장본 유지");
        JSONObject r=Store.read(new File(dir,"receipt.json"));r.put("savedCopy",new JSONObject().put("id",image.id).put("signature",image.signature).put("mime",image.mime).put("version",image.version));r.remove("savedCopyCleaned");
        Store.write(new File(dir,"receipt.json"),r.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    static void cleanup(Context c,File dir,BooleanSupplier running) throws Exception {
        MmsSource.active(running);JSONObject r=Store.read(new File(dir,"receipt.json"));if(!r.has("savedCopy")||r.optBoolean("savedCopyCleaned"))return;
        if(!new File(dir,"uploaded").isFile())throw new IOException("미전송 저장본은 유지합니다");
        OneDrive.verifyPhotoBackups(c,r);MmsSource.active(running);
        JSONObject saved=r.getJSONObject("savedCopy");if(!saved.getString("version").equals(MediaStore.getVersion(c,MediaStore.VOLUME_EXTERNAL_PRIMARY)))throw new IOException("미디어 저장소 변경 · 삭제하지 않습니다");Image current=null;for(Image i:images(c))if(i.id==saved.getLong("id"))current=i;
        if(current!=null){
            if(!current.version.equals(saved.getString("version"))||!current.signature.equals(saved.getString("signature")))throw new IOException("저장본 변경 감지 · 삭제하지 않습니다");
            byte[] bytes;try(InputStream in=c.getContentResolver().openInputStream(current.uri())){if(in==null)throw new IOException("저장본 확인 실패");bytes=in.readNBytes(10*1024*1024+1);}
            if(!Rules.sha256(bytes).equals(r.getJSONArray("photos").getJSONObject(0).getString("sha256")))throw new IOException("저장본 내용 변경 · 삭제하지 않습니다");
            if(!MediaStore.canManageMedia(c))throw new IOException("OneDrive 저장 완료 · 저장본 삭제 권한이 필요합니다");
            MmsSource.active(running);
            PendingIntent request=MediaStore.createDeleteRequest(c.getContentResolver(),List.of(current.uri()));
            android.os.Bundle options=Build.VERSION.SDK_INT>=34?ActivityOptions.makeBasic().setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED).toBundle():null;
            request.send(c,0,null,null,null,null,options);
            long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(20);boolean present=true;
            while(present&&System.nanoTime()<deadline){MmsSource.active(running);if(!saved.getString("version").equals(MediaStore.getVersion(c,MediaStore.VOLUME_EXTERNAL_PRIMARY)))throw new IOException("삭제 확인 중 저장소 변경 · 나머지 중단");present=false;for(Image i:images(c))if(i.id==saved.getLong("id"))present=true;if(present)Thread.sleep(250);}
            if(present)throw new IOException("OneDrive 저장 완료 · 휴대폰 저장본 삭제 확인 대기. 원본 문자는 유지됩니다");
        }
        r.put("savedCopyCleaned",true);Store.write(new File(dir,"receipt.json"),r.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    static void retry(Context c,String sender,long start,long end,BooleanSupplier running)throws Exception{
        File[] dirs=Store.queue(c).listFiles(File::isDirectory);if(dirs==null)return;
        for(File dir:dirs){MmsSource.active(running);if(!new File(dir,"receipt.json").isFile())continue;JSONObject r=Store.read(new File(dir,"receipt.json"));long date=r.optLong("mmsReceivedSeconds",-1);
            if(r.has("savedCopy")&&!r.optBoolean("savedCopyCleaned")&&sender.equals(r.optString("room"))&&date>=start&&date<end){
                if(MmsShareFiles.uploadAndClear(c,dir,running)==null)throw new IOException("저장 대기 사진의 임시 사본을 확인하세요");cleanup(c,dir,running);
            }
        }
    }
}
