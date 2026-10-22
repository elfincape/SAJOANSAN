package kr.ianlogistics.kakaocollector;

import android.app.*;
import android.content.*;
import android.os.*;
import java.io.File;
import java.util.concurrent.*;

public final class CollectorService extends Service {
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor();
    @Override public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("collector", "카카오톡 수집", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(this, CollectorService.class).setAction("stop");
        PendingIntent halt = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_IMMUTABLE);
        startForeground(1, new Notification.Builder(this, "collector").setSmallIcon(android.R.drawable.stat_sys_upload).setContentTitle("카카오톡 사진 수집 실행 중").setContentText("등록한 방의 사진을 OneDrive에 저장합니다").setContentIntent(open).addAction(new Notification.Action.Builder(null, "수집 중지", halt).build()).setOngoing(true).build());
        worker.scheduleWithFixedDelay(this::uploadPending, 0, 30, TimeUnit.SECONDS);
    }
    private void uploadPending() {
        if (!Store.enabled(this)) return;
        for (File f : Store.pending(this)) {
            if (!Store.enabled(this)) break;
            try { OneDrive.upload(this, f); Store.status(this, "OneDrive 저장 완료 · " + f.getName()); }
            catch (Exception e) { Store.status(this, "전송 대기 · " + e.getMessage()); break; }
        }
    }
    @Override public int onStartCommand(Intent i, int flags, int id) {
        if (i != null && "stop".equals(i.getAction())) { Store.prefs(this).edit().putBoolean("enabled", false).apply(); stopSelf(); return START_NOT_STICKY; }
        if (!Store.enabled(this)) { stopSelf(); return START_NOT_STICKY; }
        return START_STICKY;
    }
    @Override public void onDestroy() { worker.shutdownNow(); super.onDestroy(); }
    @Override public IBinder onBind(Intent i) { return null; }
}
