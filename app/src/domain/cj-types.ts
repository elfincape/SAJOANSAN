import type { DispatchProfile } from './dispatch-profiles';
import type { CharterTrip, CharterDelivery } from './charter';
import type {
  DispatchAddress,
  DispatchLeg,
  DispatchDestination,
} from '../lib/dispatch-context';
export type {
  DispatchAddress,
  DispatchLeg,
  DispatchDestination,
  CharterTrip,
  CharterDelivery,
};
export interface CJRawJob {
  id: string;
  source: string;
  code: string;
  name: string;
  deliveryName?: string;
  address: string;
  ownerRoute: string;
  kind: string;
  tons?: number | null;
  quantity: number;
  frozen: number | null;
  chilled: number | null;
  customer: string;
  sourceRow: number;
  sourceSheet: string;
  sourceRows?: number[];
}
export interface CJMember extends CJRawJob {
  pointId: string | null;
  profile: Partial<DispatchProfile> | null;
  earliestArrival: number | null;
  deadline: number | null;
  otdInvalid: boolean;
  conditionReview: boolean;
  issues: string[];
}
export interface CJJob extends CJMember {
  memberIds: string[];
  members: CJMember[];
  reason?: string;
  forceTemporary?: boolean;
  sourceDestinationId?: string;
  conditionSources?: {
    address: string;
    deadline: number | null;
    profile: Partial<DispatchProfile> | null;
  }[];
}
export interface CJFleet {
  id: string;
  route: string;
  plate: string;
  driver: string;
  tons: number | string | null;
  region?: string;
  source?: string;
  dbId?: string;
  closedDays?: number[];
  available: boolean;
  capacity: number | null;
  departureMinutes: number | null;
  maxExtraMinutes: number | null;
  splitThresholdPercent: number;
}
export type FleetSettings = Record<string, Partial<CJFleet>>;
export interface CJParsed {
  schemaVersion: number;
  date: string;
  jobs: CJRawJob[];
  fleet: Pick<
    CJFleet,
    'id' | 'route' | 'plate' | 'driver' | 'tons' | 'region' | 'source'
  >[];
  issues: { message: string; source?: string; row?: number; id?: string }[];
  sourceDates: string[];
  quantityUnit: string;
  sourceCount: number;
  sourceName?: string;
}
export interface CJRoute {
  id: string;
  name?: string;
  car_number?: string;
  primary_driver_id?: string;
  primary_vehicle_id?: string;
  active?: boolean;
  closed_days?: number[];
  vehicle?: {
    id: string;
    plate_number: string;
    tonnage: number | string | null;
  } | null;
  driver_name?: string;
  driver?: { name: string };
  stops?: {
    route_id: string;
    delivery_point_id: string;
    stop_order: number;
    deadline_business_min?: number | null;
  }[];
  dispatchKey?: string;
}
export interface HistoryPair {
  same: number;
  total: number;
  sameDates: string[];
  differentDates: string[];
}
export interface HistoryModel {
  beforeDate: string;
  days: number;
  pairs: Map<string, HistoryPair>;
  support: Map<string, Map<string, number>>;
  references: { date: string; groups: string[][] }[];
  excludedCourses: number;
  aliases: [string, string][];
}
export interface PairRelation {
  same: number;
  total: number;
  rate: number | null;
  sameDates?: string[];
  differentDates?: string[];
}
export interface CJPath {
  status: string;
  meters: number | null;
  seconds: number | null;
  hops: string[];
  priority?: string;
}
export interface CJTravel {
  sections: (CJPath & { jobId: string })[];
  complete: boolean;
  meters: number | null;
  seconds: number | null;
  knownMeters: number;
  knownSeconds: number;
  finishMinutes: number | null;
  elapsedMinutes: number | null;
  serviceMinutes: number | null;
  waitingMinutes: number | null;
  issues: string[];
  deadlineViolations: string[];
  deadlineVerified: boolean;
}
export interface DrivingGraph {
  resolve: (address: unknown) => string | null;
  path: (from: string | null, to: string | null) => CJPath;
  route: (
    jobs: CJJob[],
    options?: { origin?: string; departureMinutes?: number | null },
  ) => CJTravel;
  sameLocation: (a: unknown, b: unknown) => boolean;
  audit: {
    addresses: number;
    readLegs: number;
    validLegs: number;
    staleLegs: number;
    invalidLegs: number;
    directedPairs: number;
  };
}
export interface CJGroup {
  id: string;
  kind: string;
  label: string;
  jobIds: string[];
  capacity: number | null;
  fleetId?: string;
  baselineJobIds?: string[];
  reason?: string;
  departureMinutes?: number | null;
  historicalEvidence?: PairRelation | null;
  quantity?: number;
  issues?: string[];
  travel?: CJTravel | null;
  baselineElapsedMinutes?: number | null;
  cumulativeExtraMinutes?: number | null;
  status?: string;
}
export interface TransferCandidate {
  jobId: string;
  targetId: string;
  insertAt: number;
  extraMinutes: number;
  cumulativeExtraMinutes: number;
  travel: CJTravel;
  historyDays: number;
  status: string;
}
export interface CJPlan {
  schemaVersion: number;
  date: string;
  jobs: CJJob[];
  groups: CJGroup[];
  fleet: CJFleet[];
  notices: { jobId: string; reason: string }[];
  sourceMemberQuantities?: Record<string, number>;
  quantityUnit: string;
  sourceQuantity: number;
  modelSummary: { days: number; excludedCourses: number };
  updatedAt: string;
  transferCandidates?: TransferCandidate[];
  resourcesOutdated?: boolean;
  resourceSignature?: string;
}
export interface CJResources {
  points: DispatchDestination[];
  routes: CJRoute[];
  addresses: DispatchAddress[];
  legs: DispatchLeg[];
  history: CharterTrip[];
  beforeDate: string;
}
export interface ActualEntry {
  course: string;
  type: string;
  quantity: number | null;
  originalRoute: string;
  stopId: string;
  sourceRow: number | null;
  anchor: string;
}
export interface ComparisonRow {
  jobId: string;
  name: string;
  sourceQuantity: number;
  recordedSourceQuantity: number | null;
  unrecordedMemberIds: string[];
  actualQuantity: number | null;
  quantityDifference: number | null;
  originalRoute: string;
  predictedGroup: string;
  actualCourses: string[];
  status: string;
}
export interface CJComparison {
  date: string;
  rows: ComparisonRow[];
  unmatchedActual: { key: string; entries: ActualEntry[] }[];
  scope: string;
}
