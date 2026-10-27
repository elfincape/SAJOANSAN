package kr.ianlogistics.kakaocollector;

import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.widget.Toast;
import android.widget.TextView;

public final class MmsShareActivity extends Activity {
    static final String LABEL="이안 사진 원본 전달";
    @Override public void onCreate(Bundle saved){super.onCreate(saved);TextView status=new TextView(this);status.setText("사진 원본을 읽는 중입니다. 복사를 마치면 삼성 메시지로 돌아갑니다.");status.setPadding(32,100,32,32);setContentView(status);
        boolean trusted=false;
        try {
            String source=Build.VERSION.SDK_INT>=35&&getInitialCaller()!=null?getInitialCaller().getPackage():getCallingPackage();
            trusted=MmsShareRules.trustedPackage(this,source);if(!trusted)throw new Exception("허용된 삼성 시스템 공유 요청이 아닙니다");
            Intent intent=getIntent();if(!Intent.ACTION_SEND.equals(intent.getAction()))throw new Exception("사진 공유 요청이 아닙니다");
            Uri uri=intent.getParcelableExtra(Intent.EXTRA_STREAM,Uri.class);ClipData clips=intent.getClipData();
            if(clips!=null){if(clips.getItemCount()!=1)throw new Exception("사진은 한 장씩 전달해야 합니다");Uri clip=clips.getItemAt(0).getUri();if(uri==null)uri=clip;else if(clip!=null&&!uri.equals(clip))throw new Exception("공유 URI가 일치하지 않습니다");}
            if(uri==null||!MmsShareRules.contentUri(uri.getScheme(),uri.getAuthority()))throw new Exception("사진 원본 URI가 없습니다");
            android.content.pm.ProviderInfo provider=getPackageManager().resolveContentProvider(uri.getAuthority(),PackageManager.ComponentInfoFlags.of(0));
            if(provider==null||!MmsShareRules.systemPackage(this,provider.packageName))throw new Exception("삼성/시스템 원본 제공자를 확인하지 못했습니다");
            if(Build.VERSION.SDK_INT>=35){
                ComponentCaller caller=getInitialCaller();
                if(caller==null||!MmsShareRules.trustedPackage(this,caller.getPackage())||caller.checkContentUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION)!=PackageManager.PERMISSION_GRANTED)throw new Exception("삼성 메시지의 원본 전달 권한을 확인하지 못했습니다");
            }else if(!MmsShareRules.trustedCaller(getCallingPackage()))throw new Exception("이 단말은 공유 원본의 호출 앱 확인을 지원하지 않습니다");
            if(!MmsScreenAccess.receiveSharedImage(uri,intent.getType(),this::finish))throw new Exception("진행 중인 사진 전달 요청이 없습니다");
        }catch(Exception e){if(trusted)MmsScreenAccess.rejectSharedImage(e.getMessage());Toast.makeText(this,e.getMessage(),Toast.LENGTH_LONG).show();finish();}
    }
}
