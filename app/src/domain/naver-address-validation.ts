import type { NaverCourse } from './naver-courses';

export interface AddressCheck {
  query: string;
  status: 'valid' | 'ambiguous' | 'not_found' | 'network_error';
  confirmedAddress?: string;
  issue?: string;
  reason?: string;
  candidates?: string[];
  point?: { token: string; label: string; text: string; coordinates: number[] };
  measuredAt?: string;
}
export interface AddressUse {
  courseId: string;
  name: string;
  sourceSheet?: string;
  sourceRow: number;
  role: string;
  index: number;
}
export const addressKey = (address: string) => address.trim();
export function courseStopRole(course: NaverCourse, index: number): string {
  if (course.sourceRoles?.[index]) return course.sourceRoles[index];
  if (!index) return course.rotation === 2 ? '센터(출발)' : '차고지(출발)';
  if (index === course.stops.length - 1)
    return course.rotation === 1 ? '센터(복귀)' : '차고지(복귀)';
  if (index === 1 && course.rotation !== 2) return '센터';
  return `납품처 ${index - (course.rotation === 2 ? 0 : 1)}`;
}
export function courseAddressRows(courses: NaverCourse[]) {
  const groups = new Map<string, { original: string; address: string; uses: AddressUse[] }>();
  for (const course of courses)
    course.stops.forEach((address, index) => {
      const original = course.originalStops?.[index] ?? address;
      if (!groups.has(original)) groups.set(original, { original, address, uses: [] });
      groups.get(original)!.uses.push({
        courseId: course.id, name: course.name, sourceSheet: course.sourceSheet,
        sourceRow: course.sourceRow, role: courseStopRole(course, index), index,
      });
    });
  return [...groups.values()];
}
export function editCourseAddress(courses: NaverCourse[], original: string, value: string): NaverCourse[] {
  const address = addressKey(value);
  if (!address || address.length > 300) throw Error('검증할 주소를 1~300자로 입력해 주세요.');
  return courses.map((course) => {
    const originalStops = course.originalStops ?? [...course.stops];
    const stops = course.stops.map((current, i) => originalStops[i] === original ? address : current);
    return { ...course, originalStops, stops,
      ...(course.rotation ? {
        garage: course.rotation === 2 ? stops.at(-1)! : stops[0],
        center: course.rotation === 2 ? stops[0] : stops[1],
      } : {}),
    };
  });
}
export function validatedCourseIds(courses: NaverCourse[], results: Record<string, AddressCheck>) {
  return courses.filter((course) => course.stops.every((address) => {
    const key = addressKey(address), result = results[key];
    return result?.status === 'valid' && result.query === key;
  })).map((course) => course.id);
}
export function sameRoutingCourse(a: NaverCourse, b: NaverCourse) {
  return a.id === b.id && a.name === b.name && (a.rotation ?? 0) === (b.rotation ?? 0)
    && JSON.stringify(a.stops) === JSON.stringify(b.stops);
}
