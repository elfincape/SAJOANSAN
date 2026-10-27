package kr.ianlogistics.kakaocollector;

import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import java.io.IOException;
import java.util.*;

final class MmsShareRules {
    static boolean trustedCaller(String name) {
        return MmsScreenAccess.PACKAGE.equals(name)||"android".equals(name)||"com.android.intentresolver".equals(name)
            ||"com.samsung.android.app.sharelive".equals(name)||"com.samsung.android.app.simplesharing".equals(name);
    }
    static boolean contentUri(String scheme,String authority){return "content".equals(scheme)&&authority!=null&&!authority.isBlank();}
    static boolean systemPackage(Context context,String name){
        if(name==null)return false;
        try{return (context.getPackageManager().getApplicationInfo(name,PackageManager.ApplicationInfoFlags.of(0)).flags&(ApplicationInfo.FLAG_SYSTEM|ApplicationInfo.FLAG_UPDATED_SYSTEM_APP))!=0;}
        catch(PackageManager.NameNotFoundException e){return false;}
    }
    static boolean trustedPackage(Context context,String name){return trustedCaller(name)&&systemPackage(context,name);}
    static String rejection(Context context,String name){
        if(!trustedCaller(name))return "허용된 공유 패키지가 아님";
        try{context.getPackageManager().getApplicationInfo(name,PackageManager.ApplicationInfoFlags.of(0));}
        catch(PackageManager.NameNotFoundException e){return "앱 정보 조회 불가";}
        return "시스템 앱 확인 실패";
    }
    static String normalizedLabel(String value){return value==null?"":value.replaceAll("[\\s\\p{Z}]+","");}
    static Set<String> targetLabels(Context context) throws IOException {
        PackageManager pm=context.getPackageManager();
        List<ResolveInfo> choices=pm.queryIntentActivities(new Intent(Intent.ACTION_SEND).setType("image/*"),PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY));
        Set<String> labels=new HashSet<>();String own=context.getPackageName(),receiver=MmsShareActivity.class.getName();
        for(ResolveInfo item:choices)if(item.activityInfo!=null&&own.equals(item.activityInfo.packageName)&&receiver.equals(item.activityInfo.name)){
            labels.add(normalizedLabel(item.loadLabel(pm).toString()));labels.add(normalizedLabel(item.activityInfo.applicationInfo.loadLabel(pm).toString()));
        }
        labels.remove("");if(labels.isEmpty())throw new IOException("설치된 원본 전달 구성요소를 확인하지 못했습니다");
        for(ResolveInfo item:choices)if(item.activityInfo!=null&&!(own.equals(item.activityInfo.packageName)&&receiver.equals(item.activityInfo.name))){
            if(labels.contains(normalizedLabel(item.loadLabel(pm).toString()))||labels.contains(normalizedLabel(item.activityInfo.applicationInfo.loadLabel(pm).toString())))throw new IOException("같은 이름의 공유 대상이 여러 개라 자동 선택을 중단했습니다");
        }
        return labels;
    }
}
