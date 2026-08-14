import type { InjectablePoint } from '../types';

export interface AttendanceInjectableDraft {
  mapId: string;
  revision: number;
}

let stagedInjectablePoints: InjectablePoint[] = [];
let stagedInjectableDraft: AttendanceInjectableDraft | null = null;
const atomicProcedureIds = new Set<string>();
let pendingFriendlyError: string | null = null;

export function stageAttendanceInjectablePoints(points: InjectablePoint[]) {
  stagedInjectablePoints = points.map(point => ({ ...point }));
}

export function clearAttendanceInjectablePoints() {
  stagedInjectablePoints = [];
}

export function getAttendanceInjectablePoints(serviceIds: string[]) {
  const allowed = new Set(serviceIds);
  return stagedInjectablePoints
    .filter(point => allowed.has(point.service_id))
    .map(point => ({ ...point }));
}

export function stageAttendanceInjectableDraft(draft: AttendanceInjectableDraft) {
  stagedInjectableDraft = { ...draft };
}

export function getAttendanceInjectableDraft() {
  return stagedInjectableDraft ? { ...stagedInjectableDraft } : null;
}

export function clearAttendanceInjectableDraft() {
  stagedInjectableDraft = null;
}

export function markAtomicAttendanceProcedure(procedureId: string) {
  atomicProcedureIds.add(procedureId);
}

export function consumeAtomicAttendanceProcedure(procedureId: string) {
  if (!atomicProcedureIds.has(procedureId)) return false;
  atomicProcedureIds.delete(procedureId);
  return true;
}

export function setPendingAttendanceError(message: string) {
  pendingFriendlyError = message;
}

export function consumePendingAttendanceError() {
  const message = pendingFriendlyError;
  pendingFriendlyError = null;
  return message;
}
