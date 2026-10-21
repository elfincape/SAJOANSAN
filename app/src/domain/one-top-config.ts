export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
export const OPUS_FALLBACK_MODEL = 'claude-opus-5';
export const CAPTURE_TABLE = 'one_top_two_room_captures';
export const API_INTERVAL_MS = 1000;
export const API_RATE_RETRY_DELAYS = [20000, 40000, 60000];
export const VISION_MAX_WIDTH = 1600;
export const VISION_MAX_BYTES = 1024 * 1024;
export const EXCEL_IMAGE_MAX_WIDTH = 960;
export const EXCEL_IMAGE_MAX_HEIGHT = 720;
export const EXCEL_IMAGE_MAX_BYTES = 200 * 1024;
export const SUPPLEMENT_EXCEL_IMAGE_MAX_WIDTH = 1400;
export const SUPPLEMENT_EXCEL_IMAGE_MAX_HEIGHT = 1000;
export const SUPPLEMENT_EXCEL_IMAGE_TARGET_BYTES = 450 * 1024;
export const SUPPLEMENT_EXCEL_IMAGE_MIN_BYTES = 300 * 1024;
export const DEFAULT_TEMPLATE_PATHS = { '001':'/templates/one-top-two-room-template.xlsx', '002':'/templates/one-top-two-room-template_PYT.xlsx' };
export const TABLE_START_ROW = 5;
export const TEMPLATE_SCAN_BUFFER_ROWS = 120;
export const TEMPLATE_MIN_SCAN_ROWS = 1000;
export const TEMPLATE_MAX_SCAN_ROWS = 3000;
export const TEMPLATE_EMPTY_TAIL_ROWS = 120;
export const COL = { date:5, vehicle:8, freezer:10, refrigerated:11, compliance:14, temperaturePair:15, supplementalPhoto:16, tempPhoto:17, shipmentType:18 };
export const PROMPT = `이 이미지는 차량 온도기록 영수증이다. 보이는 값만 판독하고 추측하지 마라.
차량번호는 번호판 전체가 보이면 전체를 쓰고, 마지막 네 자리만 보이면 네 자리만 쓴다.
센터명이 보이면 center_name에 기록한다. 센터명 초성에 ㄱㅈㅇ이 들어가면 다른 후보를 고려하지 말고 반드시 곤지암으로 기록한다.
날짜는 YYYY-MM-DD, 시간은 HH:mm 형식으로 통일한다.
A와 B 온도는 부호와 소수점을 정확히 읽고 number로 반환한다.
온도 기록은 영수증에 보이는 위에서 아래 순서를 그대로 유지해 records 배열에 넣는다. 시간값을 기준으로 재정렬하지 마라.
Excel에 사용할 대표 기록은 records의 첫 번째 항목, 즉 영수증에서 가장 맨 윗줄이다. 같은 시간이 여러 줄이어도 맨 윗줄을 우선한다.
판독할 수 없는 값은 반드시 null로 반환한다.
설명이나 마크다운 없이 아래 구조의 JSON 객체 하나만 반환한다.
{"center_name":"곤지암","vehicle_number":"3161","date":"2026-07-24","records":[{"time":"02:06","a":8.6,"b":9.1}]}`;
