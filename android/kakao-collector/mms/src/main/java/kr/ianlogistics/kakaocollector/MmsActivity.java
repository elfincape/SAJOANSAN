package kr.ianlogistics.kakaocollector;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.provider.MediaStore;
import android.text.InputType;
import android.widget.*;
import android.graphics.Insets;
import android.view.WindowInsets;
import java.time.LocalDate;
import java.util.concurrent.*;
import org.json.*;

public final class MmsActivity extends Activity {
    private EditText number,client;
    private Button startDate,endDate;
    private TextView status;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private static final ExecutorService auth=Executors.newSingleThreadExecutor();
    private static volatile boolean loggingIn;
    private boolean destroyed;
    private final Runnable refresh=new Runnable(){public void run(){if(destroyed)return;status.setText(getString(R.string.mms_status,MmsService.running()?"저장 실행 중":"저장 대기",Store.pending(MmsActivity.this).length,Store.details(MmsActivity.this)));handler.postDelayed(this,1500);}};
    private void label(LinearLayout l,String text){TextView v=new TextView(this);v.setText(text);v.setTextSize(16);v.setPadding(0,16,0,8);l.addView(v);}
    private Button button(LinearLayout l,String title,Runnable action){Button b=new Button(this);b.setText(title);b.setOnClickListener(v->action.run());l.addView(b);return b;}
    private void alert(String text){if(!destroyed&&!isFinishing())new AlertDialog.Builder(this).setMessage(text).setPositiveButton("확인",null).show();}
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);if(Store.prefs(this).getString("status","").isEmpty())Store.status(this,"로그인·문자 권한을 확인한 뒤 번호와 날짜를 선택하세요");if(!MmsService.running())Store.prefs(this).edit().putBoolean("enabled",false).apply();ScrollView scroll=new ScrollView(this);LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);l.setPadding(28,32,28,32);scroll.addView(l);setContentView(scroll);
        scroll.setOnApplyWindowInsetsListener((view,insets)->{Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());view.setPadding(bars.left,bars.top,bars.right,bars.bottom);return insets;});
        label(l,"이안 문자 사진 저장 → OneDrive");
        label(l,"선택한 번호의 사진을 기간으로 저장합니다. 일반 MMS 조회와 삼성 메시지 화면 방식이 있습니다. 시작일·종료일을 모두 포함하며 한국 시간을 사용합니다. 원본 문자·첨부는 삭제하지 않습니다.");
        label(l,"Microsoft 앱 클라이언트 ID");client=new EditText(this);client.setSingleLine();client.setText(Store.prefs(this).getString("client","682488f9-cf2d-4d28-b4f4-75ba9d52e743"));client.setContentDescription("Microsoft 앱 클라이언트 ID");l.addView(client);
        button(l,"1. OneDrive 로그인",this::login);
        button(l,"2. 문자 읽기·알림 권한 허용",()->requestPermissions(new String[]{Manifest.permission.READ_SMS,Manifest.permission.POST_NOTIFICATIONS},30));
        button(l,"앱 권한 설정 열기",()->startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName()))));
        button(l,"화면 방식: 사진 전체 접근 허용",()->requestPermissions(new String[]{Manifest.permission.READ_MEDIA_IMAGES,Manifest.permission.POST_NOTIFICATIONS},31));
        button(l,"화면 방식: 저장본 삭제 권한",()->startActivity(new Intent(Settings.ACTION_REQUEST_MANAGE_MEDIA,Uri.parse("package:"+getPackageName()))));
        button(l,"화면 방식: 접근성 설정",()->startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        label(l,"사진을 보낸 번호");number=new EditText(this);number.setSingleLine();number.setInputType(InputType.TYPE_CLASS_PHONE);number.setContentDescription("사진을 보낸 번호");number.setText(Store.prefs(this).getString("mmsNumber","010-5057-7707"));l.addView(number);
        label(l,"시작일");startDate=button(l,Store.prefs(this).getString("mmsStart",LocalDate.now(MmsRules.KST).toString()),()->pick(startDate,"mmsStart"));
        label(l,"종료일");endDate=button(l,Store.prefs(this).getString("mmsEnd",LocalDate.now(MmsRules.KST).toString()),()->pick(endDate,"mmsEnd"));
        label(l,"저장 위치: 이안카카오/문자/발신번호/\n파일명은 메시지에 표시된 날짜·시간입니다. JPG·PNG·WEBP·GIF, 한 장당 10MB까지 지원합니다. 전체 대상 수는 목록에서 집계하며 기존 전송도 원격 파일을 재확인합니다.");
        button(l,"일반 MMS 기간 조회",this::export);
        label(l,"기간 전체 목록을 먼저 확인한 뒤 한 장씩 열어 저장하고 OneDrive로 전송합니다. 업로드 확인 후 이번에 만든 Download 저장본과 앱 임시 사본만 삭제합니다. 원본 문자와 기존 사진은 유지합니다. 올해·모두 받은 사진인 대화만 지원합니다. 화면 잠금 해제가 필요합니다.");
        button(l,"기간 전체 사진 수집 시작",this::exportScreen);
        button(l,"저장 중지",()->MmsService.cancel(this));
        status=new TextView(this);status.setPadding(0,24,0,24);l.addView(status);handler.post(refresh);
    }
    private void pick(Button target,String key) {
        if(Store.enabled(this)){alert("저장을 중지한 뒤 날짜를 변경하세요");return;}
        LocalDate date=LocalDate.parse(target.getText().toString());
        new DatePickerDialog(this,(view,y,m,d)->{String value=LocalDate.of(y,m+1,d).toString();target.setText(value);Store.prefs(this).edit().putString(key,value).apply();},date.getYear(),date.getMonthValue()-1,date.getDayOfMonth()).show();
    }
    private String saveClient() throws Exception {
        String id=client.getText().toString().trim();
        if(!id.matches("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"))throw new Exception("클라이언트 ID를 확인하세요");
        if(MmsService.running()||loggingIn)throw new Exception("현재 작업을 마친 뒤 진행하세요");
        if(Store.connected(this)&&!id.equals(Store.prefs(this).getString("client","")))throw new Exception("연결된 클라이언트 ID는 변경할 수 없습니다");
        Store.prefs(this).edit().putString("client",id).apply();return id;
    }
    private void export() {
        try {
            saveClient();String sender=MmsRules.phone(number.getText().toString());if(sender.isEmpty())throw new Exception("발신번호를 확인하세요");
            String a=startDate.getText().toString(),b=endDate.getText().toString();MmsRules.range(a,b);
            if(!Store.connected(this))throw new Exception("OneDrive 로그인을 먼저 완료하세요");
            if(checkSelfPermission(Manifest.permission.READ_SMS)!=PackageManager.PERMISSION_GRANTED)throw new Exception("문자 읽기 권한이 필요합니다. 권한 허용 후 다시 실행하세요. 권한 항목 자체가 없으면 설치 제한 확인이 필요합니다.");
            Store.prefs(this).edit().putString("mmsNumber",sender).putString("mmsStart",a).putString("mmsEnd",b).apply();
            Store.status(this,"기간 내 MMS 조회 준비 중");
            startForegroundService(new Intent(this,MmsService.class).putExtra("number",sender).putExtra("start",a).putExtra("end",b));
        }catch(Exception e){alert(e.getMessage());}
    }
    private void login() {
        final String id;
        try{id=saveClient();loggingIn=true;}catch(Exception e){alert(e.getMessage());return;}
        Context context=getApplicationContext();
        auth.execute(()->{
            try {
                JSONObject code=OneDrive.deviceCode(id);String url=code.getString("verification_uri"),pin=code.getString("user_code");
                if(!url.startsWith("https://microsoft.com/")&&!url.startsWith("https://www.microsoft.com/")&&!url.startsWith("https://login.microsoftonline.com/"))throw new Exception("인증 주소 확인 실패");
                handler.post(()->{if(!destroyed)new AlertDialog.Builder(this).setTitle("Microsoft 로그인 코드").setMessage(pin+"\n브라우저에 이 코드를 입력하고 앱으로 돌아오세요.").setPositiveButton("로그인 페이지 열기",(d,w)->startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(url)))).setNegativeButton("닫기",null).show();});
                OneDrive.completeDeviceLogin(context,id,code,()->!Thread.currentThread().isInterrupted(),System::currentTimeMillis,Thread::sleep);
            }catch(Exception e){Store.status(context,"로그인 미완료 · "+e.getMessage());}finally{loggingIn=false;}
        });
    }
    private void exportScreen() {
        try {
            if(checkSelfPermission(Manifest.permission.READ_MEDIA_IMAGES)!=PackageManager.PERMISSION_GRANTED)throw new Exception("화면 방식의 사진 접근을 ‘모두 허용’으로 설정하세요");
            if(!MediaStore.canManageMedia(this))throw new Exception("화면 방식: 저장본 삭제 권한을 먼저 허용하세요");
            saveClient();String sender=MmsRules.phone(number.getText().toString());if(sender.isEmpty())throw new Exception("번호를 확인하세요");
            String a=startDate.getText().toString(),b=endDate.getText().toString();MmsRules.range(a,b);int year=LocalDate.now(MmsRules.KST).getYear();
            if(LocalDate.parse(a).getYear()!=year||LocalDate.parse(b).getYear()!=year)throw new Exception("화면에 연도가 생략되므로 화면 방식은 올해 기간만 지원합니다");
            if(!Store.connected(this))throw new Exception("OneDrive 로그인이 필요합니다");
            if(!MmsScreenAccess.available())throw new Exception("접근성에서 이안 문자 사진 저장을 켜세요");
            new AlertDialog.Builder(this).setTitle("받은 사진만 있는 대화에서 시작")
                .setMessage("이 번호의 첨부 사진이 모두 상대방에게 받은 사진인 경우에만 진행하세요.\n\n지정 번호 대화로 이동하고 기간 내 전체 목록을 확인한 뒤 한 장씩 저장 → OneDrive 전송 확인 → 이번 저장본 삭제 → 다음 사진 순서로 진행합니다. 자동으로 메뉴를 찾지 못하면 해당 대화만 열어두세요. 화면을 켜고 잠금을 해제한 채 기다려 주세요. 연도 생략 날짜는 올해 "+year+"년으로 처리합니다.")
                .setNegativeButton("취소",null).setPositiveButton("모두 받은 사진 · 시작",(d,w)->{
                    if(MmsService.running())return;
                    Store.prefs(this).edit().putString("mmsNumber",sender).putString("mmsStart",a).putString("mmsEnd",b).apply();
                    startForegroundService(new Intent(this,MmsService.class).putExtra("number",sender).putExtra("start",a).putExtra("end",b).putExtra("mode","screen"));
                    try{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("sms:"+sender)).setPackage(MmsScreenAccess.PACKAGE));}
                    catch(ActivityNotFoundException e){Intent launch=getPackageManager().getLaunchIntentForPackage(MmsScreenAccess.PACKAGE);if(launch!=null)startActivity(launch);else alert("삼성 메시지의 해당 번호 대화를 직접 열어두세요");}
                }).show();
        }catch(Exception e){alert(e.getMessage());}
    }
    @Override protected void onDestroy(){destroyed=true;handler.removeCallbacksAndMessages(null);super.onDestroy();}
}
