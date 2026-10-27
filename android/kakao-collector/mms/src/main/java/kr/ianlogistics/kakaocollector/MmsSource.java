package kr.ianlogistics.kakaocollector;

import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.function.BooleanSupplier;
import org.json.*;

final class MmsSource {
    static final Uri MMS=Uri.parse("content://mms");
    static Cursor query(Context c,Uri uri,String[] columns,String where,String[] args,String order) throws IOException {
        Cursor row=c.getContentResolver().query(uri,columns,where,args,order);
        if(row==null)throw new IOException("문자 저장소를 조회하지 못했습니다");
        return row;
    }
    static boolean from(Context c,long id,String number) throws IOException {
        try(Cursor a=query(c,Uri.withAppendedPath(ContentUris.withAppendedId(MMS,id),"addr"),new String[]{"address"},"type = ?",new String[]{"137"},null)) {
            if(!a.moveToFirst()||!MmsRules.samePhone(a.getString(0),number))return false;
            return !a.moveToNext();
        }
    }
    static void active(BooleanSupplier running) throws InterruptedIOException {
        if(!running.getAsBoolean()||Thread.currentThread().isInterrupted())throw new InterruptedIOException("저장 중지됨 · 전송 대기는 유지됩니다");
    }
    static File capture(Context c,long id,long date,String sender,BooleanSupplier running) throws Exception {
        String drive=Store.prefs(c).getString("driveId","");
        if(drive.isEmpty())throw new IOException("OneDrive 로그인을 먼저 완료하세요");
        File stage=new File(Store.queue(c),"mms-staging-"+UUID.randomUUID());
        if(!stage.mkdir())throw new IOException("임시 저장공간 오류");
        try {
            JSONArray photos=new JSONArray();StringBuilder identity=new StringBuilder();
            try(Cursor parts=query(c,Uri.parse("content://mms/part"),new String[]{"_id","ct"},"mid = ?",new String[]{Long.toString(id)},"_id ASC")) {
                while(parts.moveToNext()) {
                    active(running);String mime=parts.getString(1);
                    if(mime==null||!mime.startsWith("image/"))continue;
                    if(photos.length()>=30)throw new IOException("MMS 한 건에 사진 30장 초과");
                    long part=parts.getLong(0);byte[] bytes;
                    try(InputStream in=c.getContentResolver().openInputStream(ContentUris.withAppendedId(Uri.parse("content://mms/part"),part))) {
                        if(in==null)throw new IOException("아직 내려받지 않았거나 읽을 수 없는 MMS 사진");
                        bytes=in.readNBytes(10*1024*1024+1);
                    }
                    String ext=MmsRules.extension(mime,bytes),hash=Rules.sha256(bytes);
                    String name=String.format(Locale.ROOT,"photo-%02d.%s",photos.length()+1,ext);
                    Store.write(new File(stage,name),bytes);
                    photos.put(new JSONObject().put("name",name).put("mimeType",mime).put("byteSize",bytes.length).put("sha256",hash));
                    identity.append(part).append(':').append(hash).append('\n');
                }
            }
            if(photos.length()==0)return null;
            active(running);
            String receiptId=MmsRules.receiptId(drive,id,date,sender,identity.toString());
            File destination=new File(Store.queue(c),receiptId);
            if(destination.isDirectory()&&new File(destination,"receipt.json").isFile())return destination;
            JSONObject receipt=new JSONObject().put("schemaVersion",1).put("receiptId",receiptId).put("kind","mms")
                .put("room",sender).put("mmsReceivedSeconds",date).put("mmsId",id)
                .put("observedAt",Instant.ofEpochSecond(date).toString()).put("driveId",drive).put("photos",photos);
            Store.write(new File(stage,"receipt.json"),receipt.toString(2).getBytes(StandardCharsets.UTF_8));
            if(!stage.renameTo(destination))throw new IOException("MMS 접수 저장 실패");
            return destination;
        }finally {
            File[] files=stage.listFiles();if(files!=null)for(File file:files)file.delete();stage.delete();
        }
    }
    static void run(Context c,String sender,long start,long end,BooleanSupplier running) throws Exception {
        int sent=0,existing=0,empty=0,failed=0;String last="";
        for(File pending:Store.pending(c)) {
            active(running);
            JSONObject receipt=Store.read(new File(pending,"receipt.json"));
            long date=receipt.optLong("mmsReceivedSeconds",-1);
            if(!"mms".equals(receipt.optString("kind"))||!sender.equals(receipt.optString("room"))||date<start||date>=end)continue;
            try{OneDrive.upload(c,pending,running);sent+=receipt.getJSONArray("photos").length();}catch(Exception e){Store.status(c,"미전송 MMS 재시도 실패 · "+e.getMessage());throw e;}
        }
        try(Cursor messages=query(c,Uri.withAppendedPath(MMS,"inbox"),new String[]{"_id","date","m_type"},"date >= ? AND date < ?",new String[]{Long.toString(start),Long.toString(end)},"date ASC, _id ASC")) {
            while(messages.moveToNext()) {
                active(running);long id=messages.getLong(0),date=messages.getLong(1);
                try {
                    if(!from(c,id,sender))continue;
                    if(messages.getInt(2)!=132){empty++;continue;}
                    File receipt=capture(c,id,date,sender,running);
                    if(receipt==null){empty++;continue;}
                    if(new File(receipt,"uploaded").exists()){existing++;continue;}
                    int count=Store.read(new File(receipt,"receipt.json")).getJSONArray("photos").length();
                    OneDrive.upload(c,receipt,running);sent+=count;
                }catch(InterruptedIOException e){throw e;}
                catch(SecurityException e){throw e;}
                catch(Exception e){failed++;last=e.getMessage();}
                Store.status(c,"문자 사진 처리 중 · 전송 "+sent+"장 · 기존 "+existing+"건 · 사진 없음/미다운로드 "+empty+"건 · 실패 "+failed+"건"+(last.isEmpty()?"":"\n최근 오류: "+last));
            }
        }
        Store.status(c,"기간 조회 종료 · 전송 "+sent+"장 · 기존 "+existing+"건 · 사진 없음/미다운로드 "+empty+"건 · 실패 "+failed+"건"+(last.isEmpty()?"":"\n최근 오류: "+last)+"\n0건이면 MMS 여부·번호·날짜·사진 다운로드 상태를 확인하세요.");
    }
}
