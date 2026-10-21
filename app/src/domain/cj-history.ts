import type {
  CharterTrip,
  CharterDelivery,
  HistoryModel,
  HistoryPair,
  CJJob,
  PairRelation,
} from './cj-types';
interface CourseHistory {
  keys: Set<string>;
  plates: Set<string>;
  tons: Set<number>;
  anchors: Map<string, Set<string>>;
}
import { clean, routeKey } from './cj-import';
export const pairKey = (a: string, b: string) => JSON.stringify([a, b].sort());
export const deliveryKey = (
  d: Pick<CharterDelivery, 'customer' | 'code' | 'name'>,
  trip: Partial<CharterTrip> = {},
) =>
  clean(d.customer) === '한성'
    ? 'hansung:' + routeKey(trip.vehicleSequence || d.name)
    : clean(d.code)
      ? 'sajo:' + clean(d.code)
      : 'hansung:' + routeKey(trip.vehicleSequence || d.name);
export function historicalModel(
  trips: CharterTrip[],
  date: string,
): HistoryModel {
  const before = trips.filter((t) => t.date && t.date < date),
    days = new Map<string, Map<string, CourseHistory>>(),
    aliasDays = new Map<string, Set<string>>();
  for (const t of before) {
    if (!clean(t.course)) continue;
    if (!days.has(t.date!)) days.set(t.date!, new Map());
    const courses = days.get(t.date!)!,
      ck = [clean(t.type), routeKey(t.course)].join('|');
    if (!courses.has(ck))
      courses.set(ck, {
        keys: new Set(),
        plates: new Set(),
        tons: new Set(),
        anchors: new Map(),
      });
    const c = courses.get(ck)!;
    if (clean(t.vehicleNumber)) c.plates.add(routeKey(t.vehicleNumber));
    if (typeof t.tons === 'number') c.tons.add(t.tons);
    for (const d of t.deliveries || []) {
      const key = deliveryKey(d, t);
      if (!key.endsWith(':')) c.keys.add(key);
      if (d.stopId && d.address) {
        const anchor = [t.sourceName || '', d.stopId, clean(d.address)].join(
          '|',
        );
        if (!c.anchors.has(anchor)) c.anchors.set(anchor, new Set());
        c.anchors.get(anchor)!.add(key);
      }
    }
  }
  const pairs = new Map<string, HistoryPair>(),
    support = new Map<string, Map<string, number>>(),
    references: HistoryModel['references'] = [];
  let excludedCourses = 0;
  for (const [day, courses] of days) {
    const occurrence = new Map();
    for (const c of courses.values())
      for (const k of c.keys) occurrence.set(k, (occurrence.get(k) || 0) + 1);
    const groups = [];
    for (const c of courses.values()) {
      if (c.plates.size > 1 || c.tons.size > 1) {
        excludedCourses++;
        continue;
      }
      const keys = [...c.keys].filter((k) => occurrence.get(k) === 1).sort();
      groups.push(keys);
      for (const [i, a] of keys.entries()) {
        if (!support.has(a)) support.set(a, new Map());
        for (const plate of c.plates)
          support.get(a)!.set(plate, (support.get(a)!.get(plate) || 0) + 1);
        for (const b of keys.slice(i + 1)) {
          const key = pairKey(a, b);
          if (!pairs.has(key))
            pairs.set(key, {
              same: 0,
              total: 0,
              sameDates: [],
              differentDates: [],
            });
          const p = pairs.get(key)!;
          p.same++;
          p.sameDates.push(day);
        }
      }
      for (const values of c.anchors.values()) {
        const ks = [...values].sort();
        for (let i = 0; i < ks.length; i++)
          for (const b of ks.slice(i + 1)) {
            const k = pairKey(ks[i], b);
            if (!aliasDays.has(k)) aliasDays.set(k, new Set());
            aliasDays.get(k)!.add(day);
          }
      }
    }
    const keys = [...occurrence]
      .filter(([, n]) => n === 1)
      .map(([k]) => k)
      .sort();
    const included = new Set(groups.flat());
    for (let i = 0; i < keys.length; i++)
      for (const b of keys.slice(i + 1)) {
        const a = keys[i];
        if (!included.has(a) || !included.has(b)) continue;
        const k = pairKey(a, b);
        if (!pairs.has(k))
          pairs.set(k, {
            same: 0,
            total: 0,
            sameDates: [],
            differentDates: [],
          });
        const p = pairs.get(k)!;
        p.total++;
        if (!p.sameDates.includes(day)) p.differentDates.push(day);
      }
    references.push({ date: day, groups });
  }
  return {
    beforeDate: date,
    days: days.size,
    pairs,
    support,
    references,
    excludedCourses,
    aliases: [...aliasDays]
      .filter(([, dates]) => dates.size >= 2)
      .map(([k]) => JSON.parse(k)),
  };
}
export function relation(
  a: Pick<CJJob, 'id' | 'memberIds'>,
  b: Pick<CJJob, 'id' | 'memberIds'>,
  model: HistoryModel,
): PairRelation {
  const samples: HistoryPair[] = [];
  for (const x of a.memberIds || [a.id])
    for (const y of b.memberIds || [b.id]) {
      const p = model.pairs.get(pairKey(x, y));
      if (p && p.total) samples.push(p);
    }
  if (!samples.length) return { same: 0, total: 0, rate: null };
  const best = samples.sort((x, y) => y.total - x.total)[0];
  return { ...best, rate: best.same / best.total };
}
