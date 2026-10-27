package kr.ianlogistics.kakaocollector;

import android.accessibilityservice.*;
import android.app.KeyguardManager;
import android.graphics.*;
import android.os.*;
import android.view.accessibility.*;
import java.io.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;

public final class MmsScreenAccess extends AccessibilityService {
    static final String PACKAGE="com.samsung.android.messaging";
    private static final String ID=PACKAGE+":id/";
    private static volatile MmsScreenAccess active;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ExecutorService disk=Executors.newSingleThreadExecutor();
    private Request job;
    private int state,albumWindow,backSteps,scrolls,stableTicks;
    private long deadline;
    private String albumTitle="",selectedKey="",stable="";
    private LocalDateTime selectedDate;
    private final Set<String> seen=new HashSet<>();
    private MmsScreenFiles.Snapshot before;
    private boolean scheduled,busyDisk;
    private int sent,existing;
    private int controlReveals;
    private long lastControlReveal;
    private String currentPackage="미확인",lastSamsung="";
    private static final class Request {
        final String sender;final LocalDate start,end;final BooleanSupplier running;
        final CompletableFuture<Void> done=new CompletableFuture<>();volatile boolean cancelled;
        Request(String n,String a,String b,BooleanSupplier r){sender=n;start=LocalDate.parse(a);end=LocalDate.parse(b);running=r;}
        boolean alive(){return !cancelled&&running.getAsBoolean();}
    }
    static boolean available(){return active!=null;}
    static void collect(String number,String start,String end,BooleanSupplier running) throws Exception {
        MmsScreenAccess service=active;if(service==null)throw new IOException("삼성 메시지 화면 접근성을 켜세요");
        Request r=new Request(number,start,end,running);
        int year=LocalDate.now(MmsRules.KST).getYear();
        if(r.start.getYear()!=year||r.end.getYear()!=year)throw new IOException("화면 방식은 연도 생략을 구분하기 위해 올해 기간만 지원합니다");
        service.handler.post(()->{
            if(service.job!=null){r.done.completeExceptionally(new IOException("이전 화면 작업 정리 대기"));return;}
            service.job=r;service.seen.clear();service.sent=0;service.existing=0;service.backSteps=0;service.scrolls=0;
            service.currentPackage="미확인";service.lastSamsung="";
            service.stage(0,"60초 안에 해당 번호의 사진 한 장을 전체 화면으로 여세요");
        });
        try{r.done.get();}catch(InterruptedException e){r.cancelled=true;service.handler.post(service::tick);throw e;}
        catch(ExecutionException e){throw new IOException(e.getCause().getMessage(),e.getCause());}
    }
    @Override protected void onServiceConnected(){active=this;}
    @Override public void onInterrupt(){cancel("접근성 중단 · 화면 수집 미완료");}
    @Override public void onDestroy(){if(active==this)active=null;cancel("접근성 연결 종료 · 화면 수집 미완료");disk.shutdownNow();super.onDestroy();}
    @Override public void onAccessibilityEvent(AccessibilityEvent event){if(job!=null)schedule();}
    private void cancel(String reason){Request r=job;if(r==null)return;r.cancelled=true;if(!busyDisk)finish(r,reason,true);else schedule();}
    private void finish(Request r,String message,boolean failed){if(job!=r)return;r.cancelled=true;job=null;Store.photoStatus(this,"");Store.status(this,message);if(failed)r.done.completeExceptionally(new IOException(message));else r.done.complete(null);}
    private void schedule(){if(!scheduled){scheduled=true;handler.postDelayed(()->{scheduled=false;tick();},1000);}}
    private void stage(int next,String message){state=next;controlReveals=0;lastControlReveal=0;deadline=System.currentTimeMillis()+60000;Store.photoStatus(this,"");Store.status(this,message);schedule();}
    private List<AccessibilityNodeInfo> nodes(AccessibilityNodeInfo root){List<AccessibilityNodeInfo> out=new ArrayList<>();ArrayDeque<AccessibilityNodeInfo> q=new ArrayDeque<>();if(root!=null)q.add(root);while(!q.isEmpty()&&out.size()<3000){AccessibilityNodeInfo n=q.remove();out.add(n);for(int i=0;i<n.getChildCount();i++){AccessibilityNodeInfo ch=n.getChild(i);if(ch!=null)q.add(ch);}}return out;}
    private String text(AccessibilityNodeInfo n){return n.getText()==null?"":n.getText().toString();}
    private String desc(AccessibilityNodeInfo n){return n.getContentDescription()==null?"":n.getContentDescription().toString();}
    private AccessibilityNodeInfo find(List<AccessibilityNodeInfo> list,String id){for(AccessibilityNodeInfo n:list)if(n.isVisibleToUser()&&(ID+id).equals(n.getViewIdResourceName()))return n;return null;}
    private String value(List<AccessibilityNodeInfo> list,String id){AccessibilityNodeInfo n=find(list,id);return n==null?"":text(n).isBlank()?desc(n):text(n);}
    private String diagnostic(){return "현재 앱="+currentPackage+" · 최근 삼성 화면: "+(lastSamsung.isEmpty()?"읽은 기록 없음":lastSamsung);}
    private void recordScreen(List<AccessibilityNodeInfo> list,Request r){
        AccessibilityNodeInfo number=find(list,"viewer_title");String numberState=number==null?"요소 없음":MmsRules.samePhone(value(list,"viewer_title"),r.sender)?"일치":MmsRules.phone(value(list,"viewer_title")).isEmpty()?"번호 판독 불가":"다름";
        lastSamsung="요소 "+list.size()+"개 · 뷰어="+(viewerStructure(list)?"확인":"미확인")+" · 이미지 요소="+(find(list,"viewer_image_view")!=null?"있음":"없음")+" · 번호="+numberState+" · 날짜="+(find(list,"viewer_sub_title")!=null?"있음":"없음")+" · 저장="+(find(list,"save")!=null?"있음":"없음")+" · 앨범="+(find(list,"album")!=null?"있음":"없음");
    }
    private boolean revealControls(List<AccessibilityNodeInfo> list){
        AccessibilityNodeInfo image=find(list,"viewer_image_view");
        if(image==null||find(list,"viewer_title")!=null&&find(list,"viewer_sub_title")!=null)return false;
        long now=System.currentTimeMillis();
        if(controlReveals<2&&now-lastControlReveal>=2000){
            controlReveals++;lastControlReveal=now;
            if(tap(image))Store.photoStatus(this,"사진의 숨겨진 버튼 표시 요청 · "+diagnostic());
        }
        schedule();return true;
    }
    private String title(List<AccessibilityNodeInfo> list){for(AccessibilityNodeInfo n:list)if(n.isVisibleToUser()&&text(n).matches("공유된 첨부 파일 \\(\\d+\\)"))return text(n);return "";}
    private boolean tap(AccessibilityNodeInfo node){AccessibilityNodeInfo p=node;for(int i=0;i<4&&p!=null;i++,p=p.getParent())if(p.isClickable()&&p.performAction(AccessibilityNodeInfo.ACTION_CLICK))return true;Rect b=new Rect();node.getBoundsInScreen(b);if(b.isEmpty())return false;Path path=new Path();path.moveTo(b.centerX(),b.centerY());return dispatchGesture(new GestureDescription.Builder().addStroke(new GestureDescription.StrokeDescription(path,0,80)).build(),null,null);}
    private String position(AccessibilityNodeInfo n){for(int i=0;i<4&&n!=null;i++,n=n.getParent()){AccessibilityNodeInfo.CollectionItemInfo info=n.getCollectionItemInfo();if(info!=null&&info.getRowIndex()>=0&&info.getColumnIndex()>=0)return info.getRowIndex()+":"+info.getColumnIndex();}return "";}
    private boolean boundary(AccessibilityNodeInfo grid,List<AccessibilityNodeInfo> list,boolean first) throws IOException {
        AccessibilityNodeInfo.CollectionInfo info=grid.getCollectionInfo();if(info==null||info.getRowCount()<0)throw new IOException("목록 전체 위치 정보 없음 · 나머지 미완료");
        if(info.getRowCount()==0){if("공유된 첨부 파일 (0)".equals(title(list)))return true;throw new IOException("첨부 사진 목록이 준비되지 않아 중단했습니다");}
        int min=Integer.MAX_VALUE,max=-1;Set<String> keys=new HashSet<>();
        for(AccessibilityNodeInfo n:list)if(n.isVisibleToUser()&&(ID+"gallery_item_image").equals(n.getViewIdResourceName())) {
            String key=position(n);if(key.isEmpty()||!keys.add(key))throw new IOException("목록 사진 위치가 불명확하여 중단했습니다");
            int row=Integer.parseInt(key.substring(0,key.indexOf(':')));min=Math.min(min,row);max=Math.max(max,row);
        }
        return first?min==0:max==info.getRowCount()-1;
    }
    private LocalDateTime viewerDate(List<AccessibilityNodeInfo> list){return MmsScreenRules.viewerDate(value(list,"viewer_sub_title"),LocalDate.now(MmsRules.KST).getYear());}
    private boolean viewerStructure(List<AccessibilityNodeInfo> list){return find(list,"viewer_title")!=null&&find(list,"viewer_sub_title")!=null&&find(list,"save")!=null&&find(list,"album")!=null;}
    private boolean viewerMatches(List<AccessibilityNodeInfo> list,Request r){return viewerStructure(list)&&MmsRules.samePhone(value(list,"viewer_title"),r.sender);}
    private void tick(){
        Request r=job;if(r==null)return;
        try {
            if(!r.alive()){if(busyDisk){schedule();return;}finish(r,"화면 수집 중지 · 전송 대기는 유지됩니다",true);return;}
            if(getSystemService(KeyguardManager.class).isKeyguardLocked()){cancel("화면 잠김 · 잠금을 해제하고 다시 시작하세요");return;}
            if(busyDisk){schedule();return;}
            if(System.currentTimeMillis()>deadline)throw new IOException((state==0?"사진 화면의 번호 확인":("화면 단계 "+state))+" 시간 초과 · 화면 수집 미완료\n"+diagnostic());
            AccessibilityNodeInfo root=getRootInActiveWindow();
            currentPackage=root==null?"화면 읽기 결과 없음":String.valueOf(root.getPackageName());
            if(root==null||!PACKAGE.equals(currentPackage)){if(state==0){Store.photoStatus(this,"사진 뷰어 인식 대기 · "+diagnostic());schedule();return;}throw new IOException("다른 앱으로 이동 · 화면 수집 중단\n"+diagnostic());}
            List<AccessibilityNodeInfo> list=nodes(root);
            recordScreen(list,r);
            if(state==0){
                Store.photoStatus(this,"사진 뷰어 인식 대기 · "+diagnostic());
                if(revealControls(list))return;
                if(!viewerMatches(list,r)){schedule();return;}
                viewerDate(list);
                AccessibilityNodeInfo album=find(list,"album");if(album==null||!tap(album))throw new IOException("공유 첨부 목록 열기 실패");
                stage(1,"첨부 목록의 처음으로 이동 중");return;
            }
            if(state==1||state==2||state==6){
                String currentTitle=title(list);AccessibilityNodeInfo grid=find(list,"shared_contents_recycler_view");
                if(currentTitle.isEmpty()||grid==null){schedule();return;}
                if(state==1){
                    if(++backSteps>200)throw new IOException("첨부 목록 처음 위치 확인 실패");
                    if(grid.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)){schedule();return;}
                    if(!boundary(grid,list,true))throw new IOException("첨부 목록 처음으로 이동하지 못했습니다 · 이전 사진 미완료");
                    albumTitle=currentTitle;albumWindow=root.getWindowId();stage(2,"기간 내 사진 확인 중");return;
                }
                if(root.getWindowId()!=albumWindow||!albumTitle.equals(currentTitle))throw new IOException("첨부 목록이 변경되어 중단했습니다");
                if(state==6)state=2;
                for(AccessibilityNodeInfo n:list){
                    if(!n.isVisibleToUser()||!(ID+"gallery_item_image").equals(n.getViewIdResourceName()))continue;
                    LocalDateTime date=MmsScreenRules.albumDate(desc(n),r.start.getYear());
                    if(date==null){if(!desc(n).startsWith("동영상 :"))throw new IOException("첨부 날짜·이미지 형식을 읽지 못해 중단했습니다");continue;}
                    if(!MmsScreenRules.inRange(date,r.start,r.end))continue;
                    String key=position(n);if(key.isEmpty())throw new IOException("첨부 목록의 고정 위치를 읽지 못했습니다 · 추측 수집 중단");
                    if(seen.contains(key))continue;
                    selectedKey=key;selectedDate=date;
                    if(!tap(n))throw new IOException("기간 내 사진 열기 실패");stage(3,"사진 번호·날짜 재확인 중");return;
                }
                if(++scrolls>200)throw new IOException("첨부 목록 최대 이동 초과 · 나머지 미완료");
                if(grid.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)){stage(2,"다음 첨부 사진 확인 중");return;}
                if(!boundary(grid,list,false))throw new IOException("다음 첨부 목록 이동 실패 · 나머지 미완료");
                finish(r,"화면 목록 조회 종료 · 새 전송 "+sent+"장 · 기존 "+existing+"장 · 원본 문자 유지",false);return;
            }
            if(state==3){
                if(revealControls(list))return;
                if(!viewerStructure(list)){schedule();return;}
                if(!viewerMatches(list,r))throw new IOException("선택 번호와 사진 번호가 달라 중단했습니다");
                LocalDateTime date=viewerDate(list);
                if(!MmsScreenRules.inRange(date,r.start,r.end)){seen.add(selectedKey);back();return;}
                if(!date.equals(selectedDate))throw new IOException("목록 날짜와 사진 날짜가 달라 중단했습니다");
                before=MmsScreenFiles.snapshot(this);AccessibilityNodeInfo save=find(list,"save");
                if(save==null||!tap(save))throw new IOException("사진 저장 버튼 실행 실패");stable="";stableTicks=0;stage(4,"Download 사진 파일 확인 중");return;
            }
            if(state==4){
                if(revealControls(list))return;
                if(!viewerMatches(list,r)||!viewerDate(list).equals(selectedDate))throw new IOException("저장 중 사진 화면 변경 · 연결 중단");
                List<MmsScreenFiles.Image> files=MmsScreenFiles.added(this,before);
                if(files.size()>1)throw new IOException("새 저장 사진이 여러 장이라 연결을 중단했습니다");
                if(files.size()==1){MmsScreenFiles.Image image=files.get(0);stableTicks=image.signature.equals(stable)?stableTicks+1:0;stable=image.signature;if(stableTicks>=2)persist(r,image);}
                schedule();
            }
        }catch(Exception e){finish(r,e.getMessage()==null?e.getClass().getSimpleName():e.getMessage(),true);}
    }
    private void back() throws IOException {if(!performGlobalAction(GLOBAL_ACTION_BACK))throw new IOException("첨부 목록 복귀 실패");stage(6,"첨부 목록 복귀 확인 중");}
    private void persist(Request r,MmsScreenFiles.Image image){
        busyDisk=true;final LocalDateTime date=selectedDate;final String key=selectedKey;
        Store.status(this,"원본 사진 OneDrive 전송 중");
        disk.execute(()->{
            try {
                MmsSource.active(r::alive);File dir=MmsScreenFiles.capture(this,image,r.sender,date);boolean already=new File(dir,"uploaded").isFile();
                if(!already)OneDrive.upload(this,dir,r::alive);
                try{MmsScreenFiles.cleanup(this,dir,image,r::alive);}catch(Exception e){Store.cleanupStatus(this,"Download 저장본 유지 · "+e.getMessage());}
                handler.post(()->{busyDisk=false;if(job!=r)return;if(!r.alive()){finish(r,"화면 수집 중지 · 이미 전송된 파일은 유지됩니다",true);return;}seen.add(key);if(already)existing++;else sent++;try{back();}catch(Exception e){finish(r,e.getMessage(),true);}});
            }catch(Exception e){handler.post(()->{busyDisk=false;finish(r,"사진 전송 미완료 · "+e.getMessage(),true);});}
        });
    }
}
