package kr.ianlogistics.kakaocollector;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;

public final class MainActivity extends Activity {
    private EditText client,rooms;
    private TextView status;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private static final ExecutorService auth=Executors.newSingleThreadExecutor();
    private static volatile boolean authBusy;
    private volatile boolean destroyed;
    private final Runnable refresh=new Runnable(){public void run(){ if(destroyed)return;status.setText(getString(R.string.collector_status,Store.enabled(MainActivity.this)?"수집 켜짐":"수집 꺼짐",Store.pending(MainActivity.this).length,Store.details(MainActivity.this)));handler.postDelayed(this,2000);}};
    private void label(LinearLayout layout,String text){TextView v=new TextView(this);v.setText(text);v.setTextSize(16);v.setPadding(0,16,0,8);layout.addView(v);}
    private void button(LinearLayout layout,String text,Runnable click){Button b=new Button(this);b.setText(text);b.setOnClickListener(v->click.run());layout.addView(b,new LinearLayout.LayoutParams(-1,-2));}
    @Override public void onCreate(Bundle saved){super.onCreate(saved);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        ScrollView scroll=new ScrollView(this);LinearLayout l=new LinearLayout(this);l.setOrientation(LinearLayout.VERTICAL);l.setPadding(28,32,28,32);scroll.addView(l);setContentView(scroll);
        label(l,"이안 카카오 수집 → OneDrive");
        label(l,"등록한 대화방의 화면에 보이는 사진과 주변 대화를 OneDrive의 이안카카오/대화방 이름 폴더에 한국 시간의 수집 날짜·시간 파일명으로 저장합니다. 전용폰을 켜고 잠금을 해제해 두세요. 전송 완료 후 이번 버전에서 수집한 폰 사진을 삭제합니다. 삭제 권한과 파일 일치 여부를 확인하며 확인 실패 시 남깁니다. 과거 대화 전체 수집·재부팅 후 자동 복구는 지원하지 않습니다.");
        label(l,"Microsoft 앱 클라이언트 ID (비밀 키 아님)");client=new EditText(this);client.setSingleLine();client.setText(Store.prefs(this).getString("client",""));l.addView(client);
        label(l,"수집할 대화방 이름 · 한 줄에 하나, 동일 이름 방은 사용 금지");rooms=new EditText(this);rooms.setMinLines(2);rooms.setText(Store.prefs(this).getString("rooms",""));l.addView(rooms);
        button(l,"설정 저장",()->{try{save();Store.status(this,"설정 저장됨");}catch(Exception e){alert(e.getMessage());}});
        button(l,"1. OneDrive 로그인",this::login);
        button(l,"2. 사진·알림 권한 허용",()->requestPermissions(Build.VERSION.SDK_INT>=34?new String[]{Manifest.permission.READ_MEDIA_IMAGES,Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED,Manifest.permission.POST_NOTIFICATIONS}:new String[]{Manifest.permission.READ_MEDIA_IMAGES,Manifest.permission.POST_NOTIFICATIONS},10));
        button(l,"3. 접근성 설정",()->startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)));
        button(l,"4. 알림 접근 설정",()->startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        button(l,"5. 전송 후 사진 삭제 권한",()->{
            if(android.provider.MediaStore.canManageMedia(this)){alert("사진 삭제 권한이 허용되어 있습니다. 전송 완료 사진만 정리합니다.");return;}
            try{startActivity(new Intent(Settings.ACTION_REQUEST_MANAGE_MEDIA,android.net.Uri.parse("package:"+getPackageName())));}
            catch(ActivityNotFoundException e){alert("이 기기에서 사진 삭제 권한 설정을 열지 못했습니다. 사진은 삭제하지 않고 유지합니다.");}
        });
        button(l,"수집 시작",this::start);
        button(l,"현재 열린 방 사진 수집",()->{
            try{if(!Store.enabled(this)||!KakaoAccessService.available())throw new Exception("수집 시작과 접근성 연결이 필요합니다");
                String[] names=rooms.getText().toString().trim().split("\\R");
                new AlertDialog.Builder(this).setTitle("열어둘 대화방 선택").setItems(names,(d,index)->{
                    try{KakaoAccessService.enqueue(new JSONObject().put("room",names[index].trim()).put("trigger","manual_scan"),null);
                        Intent launch=getPackageManager().getLaunchIntentForPackage("com.kakao.talk");
                        if(launch!=null)startActivity(launch);else alert("카카오톡을 직접 열어 선택한 방으로 이동하세요");
                    }catch(Exception e){alert("방 선택 실패");}
                }).show();
            }catch(Exception e){alert(e.getMessage());}
        });
        button(l,"수집 중지",()->{Store.prefs(this).edit().putBoolean("enabled",false).apply();stopService(new Intent(this,CollectorService.class));Store.status(this,"수집 중지됨 · 대기 파일은 유지됩니다");});
        status=new TextView(this);status.setPadding(0,24,0,24);l.addView(status);handler.post(refresh);
    }
    private void save() throws Exception {
        if(authBusy)throw new Exception("로그인 중에는 설정을 바꿀 수 없습니다");
        String id=client.getText().toString().trim(); if(!id.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"))throw new Exception("Microsoft 앱의 클라이언트 ID를 입력하세요");
        if(!id.equals(Store.prefs(this).getString("client",id)) && Store.connected(this))throw new Exception("연결된 클라이언트 ID는 변경할 수 없습니다");
        if(Store.enabled(this))throw new Exception("설정 변경은 수집을 중지한 뒤 진행하세요");
        Rules.validateRoomFolders(rooms.getText().toString());
        Store.prefs(this).edit().putString("client",id).putString("rooms",rooms.getText().toString().trim()).apply();
    }
    private void start(){if(Store.enabled(this)){alert("이미 수집 중입니다");return;}try{save();if(rooms.getText().toString().isBlank())throw new Exception("대화방 이름을 입력하세요");
        if(!Store.connected(this))throw new Exception("OneDrive 로그인이 필요합니다");
        if(!KakaoAccessService.available())throw new Exception("접근성 설정에서 이안 카카오 수집을 켜세요");
        if(!getSystemService(NotificationManager.class).isNotificationListenerAccessGranted(new ComponentName(this,KakaoNotificationService.class)))throw new Exception("알림 접근 설정에서 이안 카카오 수집을 켜세요");
        String permission=Manifest.permission.READ_MEDIA_IMAGES;
        if(Build.VERSION.SDK_INT>=34 && checkSelfPermission(permission)!=PackageManager.PERMISSION_GRANTED && checkSelfPermission(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)==PackageManager.PERMISSION_GRANTED)throw new Exception("일부 사진 접근으로는 새 사진 수집이 안 됩니다. 앱 권한에서 모든 사진을 허용하세요");
        if(checkSelfPermission(permission)!=PackageManager.PERMISSION_GRANTED)throw new Exception("사진 전체 접근 권한이 필요합니다");
        Store.photoStatus(this,"새 알림 대기");Store.uploadStatus(this,"대기 자료 확인 중");
        Store.prefs(this).edit().putBoolean("enabled",true).apply();startForegroundService(new Intent(this,CollectorService.class));Store.status(this,"대기 중 · 등록한 방의 새 알림 또는 현재 방 수집 사용");
    }catch(Exception e){Store.prefs(this).edit().putBoolean("enabled",false).apply();alert(e.getMessage());}}
    private void alert(String s){if(!isFinishing())new AlertDialog.Builder(this).setMessage(s).setPositiveButton("확인",null).show();}
    private void login(){try{save();if(authBusy)throw new Exception("로그인이 진행 중입니다");authBusy=true;}catch(Exception e){alert(e.getMessage());return;}
        final String id=client.getText().toString().trim();
        auth.execute(()->{try{
            JSONObject code=OneDrive.deviceCode(id);String userCode=code.getString("user_code"),url=code.getString("verification_uri");
            if(!url.startsWith("https://microsoft.com/") && !url.startsWith("https://www.microsoft.com/") && !url.startsWith("https://login.microsoftonline.com/"))throw new Exception("인증 주소 확인 실패");
            final String link=url;
            handler.post(()->{if(!destroyed)new AlertDialog.Builder(this).setTitle("Microsoft 로그인 코드").setMessage(userCode+"\n\n브라우저에서 이 코드를 입력하세요. 로그인 완료 후 수집 앱으로 돌아오세요.").setPositiveButton("로그인 페이지 열기",(d,w)->startActivity(new Intent(Intent.ACTION_VIEW,android.net.Uri.parse(link)))).setNegativeButton("닫기",null).show();});
            OneDrive.completeDeviceLogin(getApplicationContext(),id,code,()->!Thread.currentThread().isInterrupted(),System::currentTimeMillis,Thread::sleep);
        }catch(Exception e){Store.status(this,"로그인 미완료 · "+e.getMessage());}finally{authBusy=false;}});
    }
    @Override protected void onDestroy(){destroyed=true;handler.removeCallbacksAndMessages(null);super.onDestroy();}
}
