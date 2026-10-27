package kr.ianlogistics.kakaocollector;

final class MmsShareRules {
    static boolean contentUri(String scheme,String authority){return "content".equals(scheme)&&authority!=null&&!authority.isBlank();}
}
