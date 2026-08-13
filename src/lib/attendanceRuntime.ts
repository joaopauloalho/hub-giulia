import type { InjectablePoint } from '../types';

let stagedInjectablePoints: InjectablePoint[] = [];
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
