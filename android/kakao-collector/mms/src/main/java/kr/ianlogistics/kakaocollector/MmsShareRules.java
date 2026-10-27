package kr.ianlogistics.kakaocollector;

import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;

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
}
