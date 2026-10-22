package kr.ianlogistics.kakaocollector;

import android.accessibilityservice.*;
import android.app.*;
import android.graphics.*;
import android.os.*;
import android.view.accessibility.*;
import org.json.*;
import java.util.*;

public final class KakaoAccessService extends AccessibilityService {
    private static KakaoAccessService active;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ArrayDeque<Job> jobs = new ArrayDeque<>();
    private Job job;
    private int state, expected, sourceWindow, viewerWindow;
    private String viewerFingerprint;
    private List<MediaFiles.Image> readyImages;
    private long deadline;
    private String key;
    private Set<String> before;
    private JSONObject metadata;
    private boolean scheduled;
    private final java.util.concurrent.ExecutorService disk=java.util.concurrent.Executors.newSingleThreadExecutor();
    private String stable = "";
    private int stableTicks;
    private static final class Job {
        final JSONObject info; final PendingIntent open;
        Job(JSONObject i, PendingIntent p) { info=i; open=p; }
    }
    static boolean available() { return active != null; }
    static void enqueue(JSONObject info, PendingIntent open) {
        KakaoAccessService a=active; if(a==null) return;
        a.handler.post(() -> {
            if(!Store.enabled(a)) return;
            if(a.jobs.size()>=50) { Store.status(a,"알림 대기 50건 초과 · 수집 누락 가능, 대화방 확인 필요"); return; }
            a.jobs.add(new Job(info,open)); a.schedule();
        });
    }
    @Override protected void onServiceConnected() { active=this; Store.status(this,"접근성 연결됨"); }
    @Override public void onDestroy() { active=null; handler.removeCallbacksAndMessages(null); disk.shutdownNow(); super.onDestroy(); }
    @Override public void onInterrupt() { reset("접근성 중단 · 수집 상태를 확인하세요"); }
    @Override public void onAccessibilityEvent(AccessibilityEvent event) { if(Store.enabled(this)) schedule(); }
    private void schedule() { if(!scheduled) { scheduled=true; handler.postDelayed(() -> { scheduled=false; tick(); },1000); } }
    private void reset(String status) { state=0; job=null; before=null; readyImages=null; if(status!=null) Store.status(this,status); if(!jobs.isEmpty()) schedule(); }
    private List<AccessibilityNodeInfo> nodes(AccessibilityNodeInfo root) {
        List<AccessibilityNodeInfo> out=new ArrayList<>(); if(root==null) return out;
        ArrayDeque<AccessibilityNodeInfo> q=new ArrayDeque<>(); q.add(root);
        while(!q.isEmpty() && out.size()<3000) { AccessibilityNodeInfo n=q.remove(); out.add(n); for(int i=0;i<n.getChildCount();i++) { AccessibilityNodeInfo child=n.getChild(i); if(child!=null) q.add(child); } }
        return out;
    }
    private String desc(AccessibilityNodeInfo n) { return n.getContentDescription()==null?"":n.getContentDescription().toString(); }
    private String text(AccessibilityNodeInfo n) { return n.getText()==null?"":n.getText().toString(); }
    private boolean tap(AccessibilityNodeInfo n) {
        AccessibilityNodeInfo p=n;
        for(int i=0;i<3 && p!=null;i++,p=p.getParent()) if(p.isClickable() && p.performAction(AccessibilityNodeInfo.ACTION_CLICK)) return true;
        Rect b=new Rect(); n.getBoundsInScreen(b); if(b.isEmpty()) return false;
        Path path=new Path(); path.moveTo(b.centerX(),b.centerY());
        return dispatchGesture(new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(path,0,100)).build(),null,null);
    }
    private String currentRoom(List<AccessibilityNodeInfo> list) {
        for(AccessibilityNodeInfo n:list) {
            String id=n.getViewIdResourceName(), value=text(n); Rect b=new Rect();n.getBoundsInScreen(b);
            if(id!=null && (id.endsWith("/title")||id.endsWith("/chat_room_title")||id.endsWith("/toolbar_title")) && b.top>=0 && b.top<getResources().getDisplayMetrics().heightPixels/5 && Rules.allowedRoom(value,Store.prefs(this).getString("rooms",""))) return value;
        }
        return "";
    }
    private String fingerprint(AccessibilityNodeInfo root) {
        StringBuilder b=new StringBuilder();
        for(AccessibilityNodeInfo n:nodes(root)) b.append(n.getViewIdResourceName()).append('|').append(text(n)).append('|').append(desc(n)).append('\n');
        return Rules.sha256(b.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }
    private boolean sameViewer(AccessibilityNodeInfo root) {
        if(root.getWindowId()==viewerWindow && viewerFingerprint.equals(fingerprint(root))) return true;
        for(AccessibilityWindowInfo w:getWindows()) {
            AccessibilityNodeInfo other=w.getRoot();
            if(other!=null && other.getWindowId()==viewerWindow && viewerFingerprint.equals(fingerprint(other))) return true;
        }
        return false;
    }
    private void persistReady() {
        final JSONObject captured=metadata; final String capturedKey=key; final int count=expected;
        final List<MediaFiles.Image> images=readyImages; state=4;
        disk.execute(() -> {
            try {
                MediaFiles.capture(this,images,captured,capturedKey);
                Store.prefs(this).edit().putBoolean("done_"+capturedKey,true).apply();
                handler.post(() -> {
                    if(Store.enabled(this) && state==4) { state=0;before=null;readyImages=null;schedule(); }
                    Store.status(this,count+"장 로컬 확보 · OneDrive 전송 대기");
                });
            } catch(Exception e) { handler.post(() -> reset("사진 보관 실패 · 저장공간·사진 권한을 확인하세요")); }
        });
    }
    private void tick() {
        if(!Store.enabled(this)) { jobs.clear(); reset(null); return; }
        try {
            if(getSystemService(KeyguardManager.class).isKeyguardLocked()) { reset("화면 잠김 · 잠금을 해제하고 다시 수집하세요"); return; }
            if(job==null) {
                job=jobs.poll(); if(job==null) return;
                deadline=System.currentTimeMillis()+45000; state=0;
                if(job.open!=null) {
                    if(Build.VERSION.SDK_INT>=34) {
                        android.os.Bundle options=ActivityOptions.makeBasic().setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED).toBundle();
                        job.open.send(this,0,null,null,null,null,options);
                    } else job.open.send();
                    schedule(); return;
                }
            }
            if(state==4) return;
            if(System.currentTimeMillis()>deadline) { reset("사진 저장 시간 초과 · 자동 재수집하지 않았습니다. 해당 방을 확인하세요"); return; }
            AccessibilityNodeInfo root=getRootInActiveWindow();
            if(root==null || !"com.kakao.talk".contentEquals(root.getPackageName())) { if(state>0) reset("저장 도중 다른 화면으로 이동 · 사진 접수를 중단했습니다"); else schedule(); return; }
            List<AccessibilityNodeInfo> list=nodes(root);
            if(state==0) {
                String room=currentRoom(list);
                if(room.isEmpty() || !room.equals(job.info.optString("room"))) { schedule(); return; }
                StringBuilder context=new StringBuilder();
                for(AccessibilityNodeInfo n:list) { String t=text(n); if(!t.isBlank() && context.length()<20000) context.append(t).append('\n'); }
                int ordinal=0;
                for(AccessibilityNodeInfo n:list) {
                    int count=Rules.photoCount(desc(n)); if(count==0 || !n.isVisibleToUser()) continue;
                    String candidate=Rules.localKey(room,context.toString(),desc(n),ordinal++);
                    if(Store.prefs(this).getBoolean("done_"+candidate,false)) continue;
                    before=MediaFiles.snapshot(this); key=candidate; expected=count; sourceWindow=root.getWindowId();
                    metadata=new JSONObject(job.info.toString()).put("room",room).put("observedAt",java.time.Instant.now().toString())
                        .put("visibleContext",context.toString()).put("attribution","visible_context_only; notification sender is not verified as photo sender")
                        .put("expectedPhotos",expected);
                    if(!tap(n)) { reset("사진 열기 실패"); return; }
                    state=1; schedule(); return;
                }
                reset("현재 화면의 사진 확인 완료 · 화면 밖 과거 사진은 자동 탐색하지 않습니다"); return;
            }
            if(state==1) {
                for(AccessibilityNodeInfo n:list) if("com.kakao.talk:id/btn_save".equals(n.getViewIdResourceName()) || "저장".equals(desc(n))) {
                    viewerWindow=root.getWindowId(); viewerFingerprint=fingerprint(root);
                    if(!tap(n)) { reset("사진 저장 버튼 실행 실패"); return; }
                    state=2; schedule(); return;
                }
                schedule(); return;
            }
            if((state==2 || state==3) && !sameViewer(root)) { reset("사진 화면이 바뀜 · 잘못 연결하지 않도록 중단했습니다");return; }
            if(state==2) {
                String target=expected>1?"묶음사진 전체 저장":"이 사진만 저장";
                for(AccessibilityNodeInfo n:list) if(target.equals(desc(n))||target.equals(text(n))) {
                    if(!tap(n)) { reset("사진 저장 메뉴 실행 실패"); return; }
                    state=3; stable="";stableTicks=0;schedule();return;
                }
                // Single photos can save immediately without opening a choice menu.
                if(expected==1 && !MediaFiles.added(this,before).isEmpty()) state=3;
                schedule();return;
            }
            if(state==3) {
                List<MediaFiles.Image> images=MediaFiles.added(this,before);
                if(images.size()>expected) { reset("예상보다 많은 새 사진 · 잘못 연결하지 않도록 중단했습니다");return; }
                if(images.size()==expected) {
                    String signature="";for(MediaFiles.Image i:images)signature+=i.signature+";";
                    stableTicks=signature.equals(stable)?stableTicks+1:0;stable=signature;
                    if(stableTicks>=2) {
                        readyImages=images;
                        if(!performGlobalAction(GLOBAL_ACTION_BACK)) { reset("원래 대화방 확인 실패 · 사진 접수 중단");return; }
                        state=5;
                    }
                }
                schedule();
            }
            if(state==5) {
                if(root.getWindowId()==viewerWindow && sameViewer(root)) { schedule();return; }
                if(!Rules.sameSource(sourceWindow,root.getWindowId(),job.info.optString("room"),currentRoom(list))) {
                    reset("원래 허용된 대화방으로 돌아오지 못함 · 사진 접수 중단");return;
                }
                persistReady();
            }
        } catch(Exception e) { reset("수집 중단 · "+e.getClass().getSimpleName()+" · 권한과 화면을 확인하세요"); }
    }
}
