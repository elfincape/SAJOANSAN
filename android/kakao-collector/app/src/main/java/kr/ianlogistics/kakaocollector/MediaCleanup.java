package kr.ianlogistics.kakaocollector;

import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

final class MediaCleanup {
    private static MediaFiles.Image current(Context c,long id) throws IOException {
        Uri uri=ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,id);
        try(Cursor row=c.getContentResolver().query(uri,new String[]{"_id","date_modified","_size","mime_type","relative_path"},null,null,null)) {
            if(row==null)throw new IOException("삭제 대상 조회 실패");
            if(!row.moveToFirst())return null;
            if(!"Pictures/KakaoTalk/".equals(row.getString(4)))throw new IOException("삭제 대상 폴더가 달라 원본 유지");
            return new MediaFiles.Image(row.getLong(0),row.getLong(1),row.getLong(2),row.getString(3));
        }
    }
    static void run(Context c) {
        if(!Store.enabled(c)||KakaoAccessService.busy())return;
        File[] folders=Store.queue(c).listFiles(File::isDirectory);if(folders==null)return;
        for(File folder:folders) {
            if(!Store.enabled(c)||KakaoAccessService.busy())return;
            File uploaded=new File(folder,"uploaded"),done=new File(folder,"cleanup_complete");
            if(!uploaded.exists()||done.exists())continue;
            try {
                JSONObject receipt=Store.read(new File(folder,"receipt.json"));
                JSONArray photos=receipt.getJSONArray("photos");
                if(photos.length()==0){Store.write(done,new byte[]{1});continue;}
                boolean known=true;for(int i=0;i<photos.length();i++)if(photos.getJSONObject(i).optLong("sourceMediaId",0)<=0)known=false;
                if(!known){Store.write(done,new byte[]{1});continue;}
                if(!MediaStore.canManageMedia(c)){Store.cleanupStatus(c,"전송 완료 사진 정리 대기 · 사진 삭제 권한을 허용하세요");return;}
                List<Uri> targets=new ArrayList<>();
                Map<Long,String> verified=new HashMap<>();
                for(int i=0;i<photos.length();i++) {
                    JSONObject source=photos.getJSONObject(i);long id=source.getLong("sourceMediaId");
                    MediaFiles.Image image=current(c,id);if(image==null)continue;
                    if(!Rules.canCleanPhoto(uploaded.exists(),source.optString("sourceSignature"),image.signature,source.getString("sha256"),Rules.sha256(MediaFiles.read(c,image))))
                        throw new IOException("수집 당시 사진과 달라 자동 삭제 보류");
                    targets.add(ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI,id));
                    verified.put(id,image.signature);
                }
                if(targets.isEmpty()){Store.write(done,new byte[]{1});Store.cleanupStatus(c,"전송 완료 사진의 폰 저장본 정리 확인 완료");continue;}
                File requested=new File(folder,"cleanup_requested");
                if(requested.exists() && System.currentTimeMillis()-requested.lastModified()<60000){Store.cleanupStatus(c,"폰 저장 사진 삭제 확인 대기");continue;}
                OneDrive.verifyPhotoBackups(c,receipt);
                for(Map.Entry<Long,String> item:verified.entrySet()) {
                    MediaFiles.Image again=current(c,item.getKey());
                    if(again!=null&&!item.getValue().equals(again.signature))throw new IOException("삭제 직전 사진 변경 확인 · 원본 유지");
                }
                if(!Store.enabled(c)||KakaoAccessService.busy())return;
                PendingIntent request=MediaStore.createDeleteRequest(c.getContentResolver(),targets);
                android.os.Bundle options=null;
                if(Build.VERSION.SDK_INT>=34)options=ActivityOptions.makeBasic().setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED).toBundle();
                request.send(c,0,null,null,null,null,options);
                Store.write(requested,Long.toString(System.currentTimeMillis()).getBytes(StandardCharsets.UTF_8));
                Store.cleanupStatus(c,targets.size()+"장 전송 완료 사진의 폰 저장본 삭제 요청");
                return;
            }catch(Exception error){Store.cleanupStatus(c,"폰 사진 유지 · "+(error instanceof SecurityException?"사진 삭제 권한 확인 필요":error.getMessage()));}
        }
    }
}
