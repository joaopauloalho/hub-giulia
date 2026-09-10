import { useSearchParams } from 'react-router-dom';
import { TreatmentRegistrarPageV2 } from './TreatmentRegistrarPageV2';
import { ReturnRegistrarPage } from './ReturnRegistrarPage';
import './registrar-workspace.css';

export function RegistrarPage() {
  const [searchParams] = useSearchParams();
  const isReturn = Boolean(searchParams.get('return_of'));
  return <div className="registrar-route">{isReturn ? <ReturnRegistrarPage /> : <TreatmentRegistrarPageV2 />}</div>;
}
