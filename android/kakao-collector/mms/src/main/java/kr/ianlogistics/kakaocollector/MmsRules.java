package kr.ianlogistics.kakaocollector;

import java.nio.charset.StandardCharsets;
import java.time.*;
import java.util.UUID;

final class MmsRules {
    static final ZoneId KST=ZoneId.of("Asia/Seoul");
    static String phone(String value) {
        if(value==null || !value.matches("[+0-9()\\s-]+"))return "";
        String n=value.replaceAll("[()\\s-]","");
        if(n.startsWith("+82"))n="0"+n.substring(3);
        else if(n.startsWith("0082"))n="0"+n.substring(4);
        return n.matches("0[0-9]{8,10}")?n:"";
    }
    static boolean samePhone(String first,String second) {
        String n=phone(first);return !n.isEmpty()&&n.equals(phone(second));
    }
    static long[] range(String start,String end) {
        try {
            LocalDate a=LocalDate.parse(start),b=LocalDate.parse(end);
            if(b.isBefore(a))throw new IllegalArgumentException("종료일은 시작일 이후여야 합니다");
            return new long[]{a.atStartOfDay(KST).toEpochSecond(),b.plusDays(1).atStartOfDay(KST).toEpochSecond()};
        }catch(java.time.DateTimeException e){throw new IllegalArgumentException("날짜를 확인하세요");}
    }
    static String extension(String mime,byte[] b) {
        if(b.length<12||b.length>10*1024*1024)throw new IllegalArgumentException("사진당 10MB 이하만 지원합니다");
        if("image/jpeg".equals(mime)&&(b[0]&255)==255&&(b[1]&255)==216&&(b[2]&255)==255)return "jpg";
        if("image/png".equals(mime)&&(b[0]&255)==137&&b[1]==80&&b[2]==78&&b[3]==71&&b[4]==13&&b[5]==10&&b[6]==26&&b[7]==10)return "png";
        if("image/webp".equals(mime)&&b[0]==82&&b[1]==73&&b[2]==70&&b[3]==70&&b[8]==87&&b[9]==69&&b[10]==66&&b[11]==80)return "webp";
        if("image/gif".equals(mime)&&b[0]==71&&b[1]==73&&b[2]==70&&b[3]==56&&(b[4]==55||b[4]==57)&&b[5]==97)return "gif";
        throw new IllegalArgumentException("지원하지 않거나 형식이 맞지 않는 사진입니다");
    }
    static String receiptId(String drive,long message,long date,String sender,String hashes) {
        return UUID.nameUUIDFromBytes(("mms\n"+drive+"\n"+message+"\n"+date+"\n"+sender+"\n"+hashes).getBytes(StandardCharsets.UTF_8)).toString();
    }
}
