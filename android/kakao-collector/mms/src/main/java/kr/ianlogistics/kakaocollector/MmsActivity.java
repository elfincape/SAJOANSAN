package kr.ianlogistics.kakaocollector;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.text.InputType;
import android.widget.*;
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
        label(l,"이안 문자 사진 저장 → OneDrive");
        label(l,"선택한 번호에서 받은 MMS 사진을 기간으로 조회해 원본 파일로 저장합니다. 시작일과 종료일을 모두 포함하며 한국 시간을 사용합니다. 문자 원본은 삭제하지 않습니다. 채팅+(RCS)는 지원을 보장하지 않습니다.");
        label(l,"Microsoft 앱 클라이언트 ID");client=new EditText(this);client.setSingleLine();client.setText(Store.prefs(this).getString("client","682488f9-cf2d-4d28-b4f4-75ba9d52e743"));client.setContentDescription("Microsoft 앱 클라이언트 ID");l.addView(client);
        button(l,"1. OneDrive 로그인",this::login);
        button(l,"2. 문자 읽기·알림 권한 허용",()->requestPermissions(new String[]{Manifest.permission.READ_SMS,Manifest.permission.POST_NOTIFICATIONS},30));
        button(l,"앱 권한 설정 열기",()->startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName()))));
        label(l,"사진을 보낸 번호");number=new EditText(this);number.setSingleLine();number.setInputType(InputType.TYPE_CLASS_PHONE);number.setContentDescription("사진을 보낸 번호");number.setText(Store.prefs(this).getString("mmsNumber","010-5057-7707"));l.addView(number);
        label(l,"시작일");startDate=button(l,Store.prefs(this).getString("mmsStart",LocalDate.now(MmsRules.KST).toString()),()->pick(startDate,"mmsStart"));
        label(l,"종료일");endDate=button(l,Store.prefs(this).getString("mmsEnd",LocalDate.now(MmsRules.KST).toString()),()->pick(endDate,"mmsEnd"));
        label(l,"저장 위치: 이안카카오/문자/발신번호/\n파일명은 문자 수신 날짜·시간입니다. JPG·PNG·WEBP·GIF, 사진당 10MB·문자당 30장까지 지원합니다. 같은 사진문자를 다시 조회해도 이미 저장한 건은 건너뜁니다.");
        button(l,"지정 기간 사진 저장",this::export);
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
    @Override protected void onDestroy(){destroyed=true;handler.removeCallbacksAndMessages(null);super.onDestroy();}
}
