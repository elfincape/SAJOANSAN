package kr.ianlogistics.kakaocollector;

import android.app.*;
import android.content.*;
import android.os.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MmsService extends Service {
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private static AtomicBoolean current;
    private AtomicBoolean own;
    private volatile int latestStartId;
    static synchronized boolean running(){return current!=null;}
    static synchronized void cancel(Context c){if(current!=null){current.set(false);Store.status(c,"중지 처리 중 · 진행 중인 전송 응답을 기다립니다");}}
    @Override public void onCreate() {
        super.onCreate();
        NotificationManager nm=getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("mms","문자 사진 저장",NotificationManager.IMPORTANCE_LOW));
        PendingIntent open=PendingIntent.getActivity(this,0,new Intent(this,MmsActivity.class),PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop=PendingIntent.getService(this,1,new Intent(this,MmsService.class).setAction("stop"),PendingIntent.FLAG_IMMUTABLE);
        startForeground(21,new Notification.Builder(this,"mms").setSmallIcon(android.R.drawable.stat_sys_upload).setContentTitle("문자 사진 저장 중")
            .setContentText("선택한 번호·기간의 MMS 사진을 OneDrive에 저장합니다").setContentIntent(open)
            .addAction(new Notification.Action.Builder(null,"중지",stop).build()).setOngoing(true).build());
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId) {
        latestStartId=startId;
        if(intent==null){stopSelf();return START_NOT_STICKY;}
        if("stop".equals(intent.getAction())){cancel(this);if(!running())stopSelf(startId);return START_NOT_STICKY;}
        if(running())return START_NOT_STICKY;
        final String number=MmsRules.phone(intent.getStringExtra("number"));
        final long[] range;
        try {range=MmsRules.range(intent.getStringExtra("start"),intent.getStringExtra("end"));if(number.isEmpty())throw new IllegalArgumentException("번호를 확인하세요");}
        catch(Exception e){Store.status(this,"저장 조건 오류");stopSelf();return START_NOT_STICKY;}
        synchronized(MmsService.class){if(current!=null)return START_NOT_STICKY;own=new AtomicBoolean(true);current=own;Store.prefs(this).edit().putBoolean("enabled",true).apply();}
        worker.execute(()->{
            PowerManager.WakeLock lock=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"ian:mms-export");
            try {lock.acquire(20*60*1000L);MmsSource.run(this,number,range[0],range[1],()->own.get()&&Store.enabled(this));}
            catch(SecurityException e){Store.status(this,"문자 읽기 권한 또는 삼성 MMS 저장소 접근이 허용되지 않았습니다. 권한 설정을 확인하세요.");}
            catch(Exception e){Store.status(this,"저장 미완료 · "+e.getMessage());}
            finally {if(lock.isHeld())lock.release();synchronized(MmsService.class){if(current==own){Store.prefs(this).edit().putBoolean("enabled",false).apply();stopSelf(latestStartId);current=null;}}}
        });
        return START_NOT_STICKY;
    }
    @Override public void onDestroy(){if(own!=null)own.set(false);worker.shutdownNow();super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
