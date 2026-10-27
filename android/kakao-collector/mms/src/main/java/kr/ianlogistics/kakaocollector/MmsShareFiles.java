package kr.ianlogistics.kakaocollector;

import android.content.Context;
import android.net.Uri;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.function.BooleanSupplier;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import android.os.CancellationSignal;
import android.content.res.AssetFileDescriptor;
import org.json.*;

final class MmsShareFiles {
    private static final AtomicBoolean reading=new AtomicBoolean();
    private static final ExecutorService reader=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"mms-uri-reader");t.setDaemon(true);return t;});
    private static final ExecutorService closer=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"mms-uri-close");t.setDaemon(true);return t;});
    private static byte[] read(Context c,Uri uri,BooleanSupplier running) throws Exception {
        if(!reading.compareAndSet(false,true))throw new IOException("이전 원본 제공자 응답 정리 대기 · 앱 정보에서 강제 중지 후 다시 여세요");
        CancellationSignal signal=new CancellationSignal();AtomicReference<InputStream> opened=new AtomicReference<>();
        Future<byte[]> future=reader.submit(()->{
            try(AssetFileDescriptor fd=c.getContentResolver().openAssetFileDescriptor(uri,"r",signal)){
                if(fd==null)throw new IOException("공유 원본을 열 수 없습니다");
                signal.throwIfCanceled();try(InputStream in=fd.createInputStream()){opened.set(in);signal.throwIfCanceled();return in.readNBytes(10*1024*1024+1);}
            }finally{opened.set(null);reading.set(false);}
        });
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(30);
        try {
            while(true){MmsSource.active(running);if(System.nanoTime()>deadline)throw new IOException("사진 원본 읽기 30초 초과");try{return future.get(200,TimeUnit.MILLISECONDS);}catch(TimeoutException wait){}}
        }catch(Exception e){closer.execute(()->{signal.cancel();InputStream in=opened.get();if(in!=null)try{in.close();}catch(IOException ignored){}});if(e instanceof ExecutionException)throw new IOException("사진 원본 읽기 실패",e.getCause());throw e;}
    }
    static File capture(Context c,Uri uri,String advertisedMime,String sender,LocalDateTime date,BooleanSupplier running,Map<String,Integer> occurrences) throws Exception {
        MmsSource.active(running);
        if(!MmsShareRules.contentUri(uri.getScheme(),uri.getAuthority()))throw new IOException("공유 원본 URI 형식 오류");
        byte[] bytes=read(c,uri,running);
        String mime="image/jpg".equals(advertisedMime)?"image/jpeg":advertisedMime;
        if(mime==null||mime.equals("image/*")||mime.equals("application/octet-stream"))for(String candidate:new String[]{"image/jpeg","image/png","image/webp","image/gif"})try{MmsRules.extension(candidate,bytes);mime=candidate;break;}catch(IllegalArgumentException ignored){}
        String ext=MmsRules.extension(mime,bytes),hash=Rules.sha256(bytes);MmsSource.active(running);
        String drive=Store.prefs(c).getString("driveId","");if(drive.isEmpty())throw new IOException("OneDrive 연결 확인 필요");
        int occurrence=occurrences.merge(date+"\n"+hash,1,Integer::sum);
        long time=date.atZone(MmsRules.KST).toEpochSecond();String id=MmsRules.receiptId(drive,0,time,sender,"samsung_share\n"+hash+"\n"+occurrence);
        File dir=new File(Store.queue(c),id);
        if(new File(dir,"receipt.json").isFile()){
            JSONObject old=Store.read(new File(dir,"receipt.json")),p=old.getJSONArray("photos").getJSONObject(0);String name=p.getString("name");
            if(!"samsung_share".equals(old.optString("source"))||!drive.equals(old.optString("driveId"))||!sender.equals(old.optString("room"))||!hash.equals(p.optString("sha256"))||!Rules.safeName(name)||name.endsWith(".json"))throw new IOException("기존 공유 접수 검증 실패");
            Store.write(new File(dir,name),bytes);return dir;
        }
        if(dir.exists()&&!dir.renameTo(new File(Store.queue(c),"incomplete-share-"+id+"-"+UUID.randomUUID())))throw new IOException("미완성 접수 보존 실패");
        if(!dir.mkdir())throw new IOException("사진 접수 저장공간 오류");
        try {
            String name="photo-01."+ext;Store.write(new File(dir,name),bytes);
            JSONObject p=new JSONObject().put("name",name).put("mimeType",mime).put("byteSize",bytes.length).put("sha256",hash);
            JSONObject r=new JSONObject().put("schemaVersion",1).put("receiptId",id).put("kind","mms").put("source","samsung_share")
                .put("room",sender).put("mmsReceivedSeconds",time).put("observedAt",date.atZone(MmsRules.KST).toInstant().toString())
                .put("driveId",drive).put("photos",new JSONArray().put(p));
            Store.write(new File(dir,"receipt.json"),r.toString(2).getBytes(StandardCharsets.UTF_8));return dir;
        }catch(Exception e){File[] fs=dir.listFiles();if(fs!=null)for(File f:fs)f.delete();dir.delete();throw e;}
    }
    static void clearUploaded(File dir) throws Exception {
        if(!new File(dir,"uploaded").isFile())throw new IOException("미전송 사진의 임시 파일은 유지합니다");
        JSONObject receipt=Store.read(new File(dir,"receipt.json"));
        if(!"samsung_share".equals(receipt.optString("source"))&&!"samsung_screen".equals(receipt.optString("source")))throw new IOException("화면 사진 접수가 아닙니다");
        JSONArray photos=receipt.getJSONArray("photos");
        for(int i=0;i<photos.length();i++){
            String name=photos.getJSONObject(i).getString("name");if(!Rules.safeName(name)||name.endsWith(".json"))throw new IOException("임시 사진 이름 오류");
            File f=new File(dir,name);if(f.exists()&&!f.delete())throw new IOException("OneDrive 전송 완료 · 앱 임시 사진 정리 실패");
        }
    }
    static Boolean uploadAndClear(Context c,File dir,BooleanSupplier running) throws Exception {
        MmsSource.active(running);File marker=new File(dir,"uploaded");boolean already=marker.isFile();
        if(already)try{OneDrive.verifyPhotoBackups(c,Store.read(new File(dir,"receipt.json")));}
        catch(OneDrive.HttpFailure e){if(e.status!=404)throw e;if(!marker.delete())throw new IOException("원격 파일 재확인 상태 저장 실패");already=false;}
        if(!already){
            JSONObject receipt=Store.read(new File(dir,"receipt.json"));JSONArray photos=receipt.getJSONArray("photos");
            for(int i=0;i<photos.length();i++){JSONObject p=photos.getJSONObject(i);String name=p.getString("name");if(!Rules.safeName(name)||name.endsWith(".json"))throw new IOException("대기 사진 이름 오류");File f=new File(dir,name);if(!f.isFile()||f.length()!=p.getLong("byteSize"))return null;}
            OneDrive.upload(c,dir,running);
        }
        clearUploaded(dir);return already;
    }
    static void retry(Context c,String sender,long start,long end,BooleanSupplier running) throws Exception {
        File[] dirs=Store.queue(c).listFiles(File::isDirectory);if(dirs==null)return;
        for(File dir:dirs){
            MmsSource.active(running);if(!new File(dir,"receipt.json").isFile())continue;
            JSONObject r=Store.read(new File(dir,"receipt.json"));long date=r.optLong("mmsReceivedSeconds",-1);
            if((!"samsung_share".equals(r.optString("source"))&&!"samsung_screen".equals(r.optString("source")))||!sender.equals(r.optString("room"))||date<start||date>=end)continue;
            uploadAndClear(c,dir,running);
        }
    }
}
