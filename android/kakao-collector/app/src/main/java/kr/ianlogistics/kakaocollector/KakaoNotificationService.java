package kr.ianlogistics.kakaocollector;

import android.app.*;
import android.os.*;
import android.service.notification.*;
import org.json.*;

public final class KakaoNotificationService extends NotificationListenerService {
    private final java.util.concurrent.ExecutorService disk=java.util.concurrent.Executors.newSingleThreadExecutor();
    @Override public void onDestroy(){disk.shutdownNow();super.onDestroy();}
    @Override public void onNotificationPosted(StatusBarNotification sbn) {
        if (!Store.enabled(this) || !"com.kakao.talk".equals(sbn.getPackageName())) return;
        Notification n = sbn.getNotification();
        if ((n.flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        String room = n.extras.getString(Notification.EXTRA_CONVERSATION_TITLE);
        if (room == null) room = String.valueOf(n.extras.getCharSequence(Notification.EXTRA_TITLE, ""));
        if (!Rules.allowedRoom(room, Store.prefs(this).getString("rooms", ""))) return;
        try {
            JSONObject info = new JSONObject().put("room", room).put("notificationPostedAt", sbn.getPostTime())
                .put("notificationText", String.valueOf(n.extras.getCharSequence(Notification.EXTRA_TEXT, "")))
                .put("notificationKey", sbn.getKey());
            JSONArray messages=new JSONArray();
            android.os.Parcelable[] bundles=n.extras.getParcelableArray(Notification.EXTRA_MESSAGES);
            if(bundles!=null) for(Notification.MessagingStyle.Message message:Notification.MessagingStyle.Message.getMessagesFromBundleArray(bundles)) {
                messages.put(new JSONObject().put("text",String.valueOf(message.getText())).put("timestamp",message.getTimestamp())
                    .put("sender",message.getSenderPerson()==null?JSONObject.NULL:String.valueOf(message.getSenderPerson().getName())));
            }
            info.put("messages",messages);
            JSONObject event=new JSONObject(info.toString());
            disk.execute(()->{try{
                if(!Store.enabled(this))return;
                String id=java.util.UUID.nameUUIDFromBytes(event.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
                java.io.File dir=new java.io.File(Store.queue(this),id);
                if(new java.io.File(dir,"receipt.json").exists())return;
                if(!dir.exists()&&!dir.mkdir())throw new java.io.IOException();
                event.put("schemaVersion",1).put("kind","notification").put("receiptId",id).put("photos",new JSONArray())
                    .put("driveId",Store.prefs(this).getString("driveId",""))
                    .put("observedAt",java.time.Instant.now().toString()).put("attribution","notification_only; may be truncated");
                Store.write(new java.io.File(dir,"receipt.json"),event.toString(2).getBytes(java.nio.charset.StandardCharsets.UTF_8));
            }catch(Exception e){Store.status(this,"대화 알림 보관 실패 · 저장공간을 확인하세요");}});
            KakaoAccessService.enqueue(info, n.contentIntent);
        } catch (JSONException e) { Store.status(this, "알림 정보 읽기 실패"); }
    }
}
