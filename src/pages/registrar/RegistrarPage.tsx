import { useSearchParams } from 'react-router-dom';
import { TreatmentRegistrarPageV2 } from './TreatmentRegistrarPageV2';
import { ReturnRegistrarPage } from './ReturnRegistrarPage';
import { EditAttendancePage } from './EditAttendancePage';
import './registrar-workspace.css';

export function RegistrarPage() {
  const [searchParams] = useSearchParams();
  const isEdit = Boolean(searchParams.get('edit'));
  const isReturn = Boolean(searchParams.get('return_of'));
  return <div className="registrar-route">{isEdit ? <EditAttendancePage /> : isReturn ? <ReturnRegistrarPage /> : <TreatmentRegistrarPageV2 />}</div>;
}
