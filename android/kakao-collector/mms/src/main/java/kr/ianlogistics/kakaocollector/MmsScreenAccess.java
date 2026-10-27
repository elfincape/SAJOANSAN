package kr.ianlogistics.kakaocollector;

import android.accessibilityservice.*;
import android.app.KeyguardManager;
import android.graphics.*;
import android.os.*;
import android.net.Uri;
import android.view.accessibility.*;
import java.io.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.BooleanSupplier;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MmsScreenAccess extends AccessibilityService {
    static final String PACKAGE="com.samsung.android.messaging";
    private static final String ID=PACKAGE+":id/";
    private static volatile MmsScreenAccess active;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private final ExecutorService disk=Executors.newSingleThreadExecutor();
    private Request job;
    private int state,albumWindow,backSteps,scrolls,shareScrolls;
    private long deadline;
    private long unexpectedShareSince;
    private String albumTitle="",selectedKey="";
    private LocalDateTime selectedDate;
    private final Set<String> seen=new HashSet<>();
    private Set<String> shareLabels=Set.of();
    private final LinkedHashMap<String,LocalDateTime> plan=new LinkedHashMap<>();
    private boolean planning,shareTargetClicked,moreRequested,conversationMenuRequested,shareBackRequested;
    private boolean scheduled,busyDisk;
    private int sent,existing,cleaned,excluded;
    private int controlReveals;
    private long lastControlReveal;
    private String currentPackage="미확인",lastSamsung="";
    private static final class Request {
        final String sender;final LocalDate start,end;final BooleanSupplier running;
        final CompletableFuture<Void> done=new CompletableFuture<>();volatile boolean cancelled;
        final Map<String,Integer> occurrences=new HashMap<>();
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
            service.job=r;service.seen.clear();service.plan.clear();service.planning=true;service.sent=0;service.existing=0;service.cleaned=0;service.excluded=0;service.backSteps=0;service.scrolls=0;service.conversationMenuRequested=false;
            service.currentPackage="미확인";service.lastSamsung="";
            service.stage(0,"지정 번호의 대화·공유 첨부 목록 확인 중");
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
    private void stage(int next,String message){state=next;controlReveals=0;lastControlReveal=0;deadline=System.currentTimeMillis()+60000;Store.photoStatus(this,"");Store.status(this,message+progress());schedule();}
    private String progress(){return planning?"":" · 확인 "+seen.size()+"/"+plan.size()+" · 전송 "+sent+" · 기존 "+existing+" · 임시 정리 "+cleaned;}
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
    private AccessibilityNodeInfo sharedMenu(List<AccessibilityNodeInfo> list){for(AccessibilityNodeInfo n:list)if(n.isVisibleToUser())for(String s:new String[]{text(n),desc(n)})if(s.replaceAll("\\s+","").matches("공유된첨부파일(?:\\(\\d+\\))?"))return n;return null;}
    private boolean conversationMatches(List<AccessibilityNodeInfo> list,Request r){
        int limit=getResources().getDisplayMetrics().heightPixels/4;
        for(AccessibilityNodeInfo n:list){Rect b=new Rect();n.getBoundsInScreen(b);if(n.isVisibleToUser()&&b.top>=0&&b.top<limit&&(MmsRules.samePhone(text(n),r.sender)||MmsRules.samePhone(desc(n),r.sender)))return true;}
        return false;
    }
    private boolean openConversationAttachments(List<AccessibilityNodeInfo> list,Request r) throws IOException {
        if(!conversationMenuRequested&&!conversationMatches(list,r))return false;
        AccessibilityNodeInfo shared=sharedMenu(list);if(shared!=null){if(!tap(shared))throw new IOException("대화 첨부 목록 열기 실패");stage(1,"첨부 목록 처음 확인 중");return true;}
        if(!conversationMenuRequested){
            int limit=getResources().getDisplayMetrics().heightPixels/4;
            for(AccessibilityNodeInfo n:list){Rect b=new Rect();n.getBoundsInScreen(b);String label=(text(n)+desc(n)).replaceAll("\\s+","");if(n.isVisibleToUser()&&b.top>=0&&b.top<limit&&(label.equals("옵션더보기")||label.equals("더보기")||label.equals("대화설정"))){if(tap(n)){conversationMenuRequested=true;Store.status(this,"대화 번호 확인 · 공유 첨부 메뉴 찾는 중");schedule();return true;}}}
        }
        return false;
    }
    private void chooseShareTarget(List<AccessibilityNodeInfo> list) throws IOException {
        if(shareTargetClicked){schedule();return;}
        for(AccessibilityNodeInfo n:list)if(n.isVisibleToUser()&&(shareLabels.contains(MmsShareRules.normalizedLabel(text(n)))||shareLabels.contains(MmsShareRules.normalizedLabel(desc(n))))){if(!tap(n))throw new IOException("원본 전달 앱 선택 실패");shareTargetClicked=true;Store.status(this,"공유 원본 URI 수신 대기"+progress());schedule();return;}
        if(!moreRequested)for(AccessibilityNodeInfo n:list)if(n.isVisibleToUser())for(String label:new String[]{text(n),desc(n)})if(Set.of("더보기","앱더보기","모든앱").contains(label.replaceAll("\\s+",""))){if(tap(n)){moreRequested=true;schedule();return;}}
        if(!PACKAGE.equals(currentPackage)&&!getPackageName().equals(currentPackage)&&shareScrolls<8)for(AccessibilityNodeInfo n:list)if(n.isVisibleToUser()&&n.isScrollable()&&n.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)){shareScrolls++;schedule();return;}
        Store.photoStatus(this,"공유 대상 찾는 중 · 현재 앱="+currentPackage+" · "+MmsShareActivity.LABEL+" 선택 대기");schedule();
    }
    private void tick(){
        Request r=job;if(r==null)return;
        try {
            if(!r.alive()){if(busyDisk){schedule();return;}finish(r,"화면 수집 중지 · 전송 대기는 유지됩니다",true);return;}
            if(getSystemService(KeyguardManager.class).isKeyguardLocked()){cancel("화면 잠김 · 잠금을 해제하고 다시 시작하세요");return;}
            if(busyDisk){schedule();return;}
            if(System.currentTimeMillis()>deadline)throw new IOException((state==0?"사진 화면의 번호 확인":("화면 단계 "+state))+" 시간 초과 · 화면 수집 미완료\n"+diagnostic());
            AccessibilityNodeInfo root=getRootInActiveWindow();
            currentPackage=root==null?"화면 읽기 결과 없음":String.valueOf(root.getPackageName());
            if(state==7){
                if(root==null){schedule();return;}
                if(!MmsShareRules.trustedPackage(this,currentPackage)&&!getPackageName().equals(currentPackage)){
                    long now=System.currentTimeMillis();if(unexpectedShareSince==0)unexpectedShareSince=now;
                    if(now-unexpectedShareSince<5000){Store.photoStatus(this,"공유창 전환 대기 · 현재 앱="+currentPackage);schedule();return;}
                    throw new IOException("공유 화면 확인 실패 · 앱="+currentPackage+" · "+MmsShareRules.rejection(this,currentPackage));
                }
                unexpectedShareSince=0;
                chooseShareTarget(nodes(root));return;
            }
            if(state==8&&!PACKAGE.equals(currentPackage)){
                if(MmsShareRules.trustedPackage(this,currentPackage)&&!shareBackRequested){shareBackRequested=true;performGlobalAction(GLOBAL_ACTION_BACK);}
                schedule();return;
            }
            if(root==null||!PACKAGE.equals(currentPackage)){if(state==0){Store.photoStatus(this,"사진 뷰어 인식 대기 · "+diagnostic());schedule();return;}throw new IOException("다른 앱으로 이동 · 화면 수집 중단\n"+diagnostic());}
            List<AccessibilityNodeInfo> list=nodes(root);
            recordScreen(list,r);
            if(state==0){
                Store.photoStatus(this,"사진 뷰어 인식 대기 · "+diagnostic());
                if(revealControls(list))return;
                if(!viewerMatches(list,r)){if(openConversationAttachments(list,r))return;schedule();return;}
                viewerDate(list);
                AccessibilityNodeInfo album=find(list,"album");if(album==null||!tap(album))throw new IOException("공유 첨부 목록 열기 실패");
                stage(1,"첨부 목록의 처음으로 이동 중");return;
            }
            if(state==8){
                if(title(list).equals(albumTitle)&&root.getWindowId()==albumWindow){stage(6,"첨부 목록 복귀 확인 중");return;}
                if(!viewerMatches(list,r)||!viewerDate(list).equals(selectedDate))throw new IOException("공유 후 원래 사진으로 돌아오지 못했습니다");back();return;
            }
            if(state==1||state==2||state==6||state==9){
                String currentTitle=title(list);AccessibilityNodeInfo grid=find(list,"shared_contents_recycler_view");
                if(currentTitle.isEmpty()||grid==null){schedule();return;}
                if(state==1||state==9){
                    if(state==9&&(root.getWindowId()!=albumWindow||!albumTitle.equals(currentTitle)))throw new IOException("대상 확정 후 목록 변경 · 중단");
                    if(++backSteps>200)throw new IOException("첨부 목록 처음 위치 확인 실패");
                    if(grid.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)){schedule();return;}
                    if(!boundary(grid,list,true))throw new IOException("첨부 목록 처음으로 이동하지 못했습니다 · 이전 사진 미완료");
                    if(state==1){albumTitle=currentTitle;albumWindow=root.getWindowId();}
                    stage(2,planning?"기간 내 전체 사진 목록 확인 중":"확정한 기간 사진 처리 중");return;
                }
                if(root.getWindowId()!=albumWindow||!albumTitle.equals(currentTitle))throw new IOException("첨부 목록이 변경되어 중단했습니다");
                if(state==6)state=2;
                boundary(grid,list,false);
                for(AccessibilityNodeInfo n:list){
                    if(!n.isVisibleToUser()||!(ID+"gallery_item_image").equals(n.getViewIdResourceName()))continue;
                    LocalDateTime date=MmsScreenRules.albumDate(desc(n),r.start.getYear());
                    if(date==null){if(!desc(n).startsWith("동영상 :"))throw new IOException("첨부 날짜·이미지 형식을 읽지 못해 중단했습니다");continue;}
                    if(!MmsScreenRules.inRange(date,r.start,r.end))continue;
                    String key=position(n);if(key.isEmpty())throw new IOException("첨부 목록의 고정 위치를 읽지 못했습니다 · 추측 수집 중단");
                    if(planning){LocalDateTime previous=plan.putIfAbsent(key,date);if(previous!=null&&!previous.equals(date))throw new IOException("전체 조회 중 첨부 순서가 바뀌었습니다");continue;}
                    if(!date.equals(plan.get(key)))throw new IOException("확정한 대상 목록과 사진 순서가 달라졌습니다");
                    if(seen.contains(key))continue;
                    selectedKey=key;selectedDate=date;
                    if(!tap(n))throw new IOException("기간 내 사진 열기 실패");stage(3,"사진 번호·날짜 재확인 중");return;
                }
                if(++scrolls>200)throw new IOException("첨부 목록 최대 이동 초과 · 나머지 미완료");
                if(grid.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)){stage(2,planning?"기간 전체 조회 · 후보 "+plan.size()+"장":"다음 첨부 사진 확인 중");return;}
                if(!boundary(grid,list,false))throw new IOException("다음 첨부 목록 이동 실패 · 나머지 미완료");
                if(planning){planning=false;backSteps=0;scrolls=0;if(plan.isEmpty()){finish(r,"전체 목록 조회 완료 · 기간 내 대상 0장",false);return;}stage(9,"기간 후보 "+plan.size()+"장 확정 · 처음으로 복귀");return;}
                if(seen.size()!=plan.size()||sent+existing+excluded!=plan.size()||cleaned!=sent+existing)throw new IOException("기간 전체 처리 미완료"+progress());
                finish(r,"기간 전체 처리 완료 · 대상 "+(plan.size()-excluded)+"장 · 새 전송 "+sent+"장 · 기존 "+existing+"장 · 임시 정리 확인 "+cleaned+"장 · 연도/기간 제외 "+excluded+"장 · 원본문자 유지",false);return;
            }
            if(state==3){
                if(revealControls(list))return;
                if(!viewerStructure(list)){schedule();return;}
                if(!viewerMatches(list,r))throw new IOException("선택 번호와 사진 번호가 달라 중단했습니다");
                LocalDateTime date=viewerDate(list);
                if(!MmsScreenRules.inRange(date,r.start,r.end)){seen.add(selectedKey);excluded++;back();return;}
                if(!date.equals(selectedDate))throw new IOException("목록 날짜와 사진 날짜가 달라 중단했습니다");
                AccessibilityNodeInfo share=find(list,"share");if(share==null)throw new IOException("사진 원본 공유 버튼을 읽지 못했습니다");
                shareLabels=MmsShareRules.targetLabels(this);
                shareTargetClicked=false;moreRequested=false;shareScrolls=0;unexpectedShareSince=0;stage(7,"사진 원본 공유 요청 중");
                if(!tap(share))throw new IOException("사진 공유 버튼 실행 실패");return;
            }
        }catch(Exception e){finish(r,e.getMessage()==null?e.getClass().getSimpleName():e.getMessage(),true);}
    }
    private void back() throws IOException {if(!performGlobalAction(GLOBAL_ACTION_BACK))throw new IOException("첨부 목록 복귀 실패");stage(6,"첨부 목록 복귀 확인 중");}
    static boolean receiveSharedImage(Uri uri,String mime,Runnable closeActivity){
        MmsScreenAccess a=active;if(a==null||a.job==null||a.state!=7||a.busyDisk||!a.job.alive())return false;
        Request r=a.job;a.busyDisk=true;final LocalDateTime date=a.selectedDate;final String key=a.selectedKey;AtomicBoolean closed=new AtomicBoolean();
        Runnable close=()->{if(closed.compareAndSet(false,true))a.handler.post(closeActivity);};
        Store.status(a,"공유 원본을 앱 임시 공간에 복사 중"+a.progress());
        a.disk.execute(()->{
            try {
                MmsSource.active(r::alive);File dir=MmsShareFiles.capture(a,uri,mime,r.sender,date,r::alive,r.occurrences);close.run();
                Store.status(a,"사진 OneDrive 전송·임시 정리 중"+a.progress());
                Boolean result=MmsShareFiles.uploadAndClear(a,dir,r::alive);if(result==null)throw new IOException("공유 사진 임시 사본이 없어 재확인이 필요합니다");boolean already=result;
                a.handler.post(()->{a.busyDisk=false;if(a.job!=r)return;if(!r.alive()){a.finish(r,"화면 수집 중지 · 이미 전송된 파일은 유지됩니다",true);return;}a.seen.add(key);if(already)a.existing++;else a.sent++;a.cleaned++;a.shareBackRequested=false;a.stage(8,"원본 전송·임시 정리 완료 · 다음 사진 준비");});
            }catch(Exception e){close.run();a.handler.post(()->{a.busyDisk=false;a.finish(r,"사진 전송 미완료 · "+e.getMessage()+a.progress(),true);});}
        });
        return true;
    }
    static void rejectSharedImage(String reason){MmsScreenAccess a=active;if(a!=null&&a.job!=null&&a.state==7&&!a.busyDisk)a.finish(a.job,"사진 원본 전달 실패 · "+reason,true);}
}
