package kr.ianlogistics.kakaocollector;

import java.time.*;
import java.util.regex.*;

final class MmsScreenRules {
    static LocalDateTime viewerDate(String value,int year) {
        Matcher m=Pattern.compile("^(?:(\\d{4})년\\s*)?(\\d{1,2})월\\s*(\\d{1,2})일,\\s*(오전|오후)\\s*(\\d{1,2}):(\\d{2})$").matcher(value.trim());
        if(!m.matches())throw new IllegalArgumentException("사진 날짜 표시를 확인하지 못했습니다");
        try {
            int hour=Integer.parseInt(m.group(5));if(hour<1||hour>12)throw new IllegalArgumentException("사진 시간 표시 오류");
            return LocalDateTime.of(m.group(1)==null?year:Integer.parseInt(m.group(1)),Integer.parseInt(m.group(2)),Integer.parseInt(m.group(3)),hour%12+("오후".equals(m.group(4))?12:0),Integer.parseInt(m.group(6)));
        }catch(DateTimeException e){throw new IllegalArgumentException("사진 날짜 표시 오류");}
    }
    static LocalDateTime albumDate(String value,int year) {
        Matcher m=Pattern.compile("^이미지\\s*:\\s*(\\d{2})-(\\d{2}) (\\d{2}):(\\d{2}), image/(jpeg|png|webp|gif)$").matcher(value);
        if(!m.matches())return null;
        try{return LocalDateTime.of(year,Integer.parseInt(m.group(1)),Integer.parseInt(m.group(2)),Integer.parseInt(m.group(3)),Integer.parseInt(m.group(4)));}
        catch(DateTimeException e){return null;}
    }
    static boolean inRange(LocalDateTime value,LocalDate start,LocalDate end) {
        return !value.toLocalDate().isBefore(start)&&!value.toLocalDate().isAfter(end);
    }
}
