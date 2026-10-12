import { useEffect, useState } from 'react';
import { CakeSlice, ChevronRight, MessageCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { clinicToday, listContactCalendar } from '../../lib/contactCalendar';
export function ContactCalendarHome() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState<{ birthdays: number; procedures: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const today = clinicToday();
    void listContactCalendar(today, today).then(items => {
      if (alive) setSummary({ birthdays: items.filter(row => row.kind === 'birthday').length,
        procedures: items.filter(row => row.kind === 'procedure').length });
    }).catch(() => { if (alive) setSummary(null); });
    return () => { alive = false; };
  }, []);
  return <button type="button" className="card" onClick={() => navigate('/relacionamento?view=calendar')}
    style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12, padding:16, textAlign:'left', cursor:'pointer', marginBottom:16 }}>
    <div><strong>Contatos sugeridos para hoje</strong><p className="page-sub" style={{ margin:'4px 0 0' }}>Uma olhada por dia, sem cobranças.</p></div>
    <div style={{ display:'flex',alignItems:'center',gap:12,flexWrap:'wrap' }}>
      {summary ? <><span><CakeSlice size={15}/> {summary.birthdays} aniversários</span><span><MessageCircle size={15}/> {summary.procedures} procedimentos</span></> : <span className="page-sub">Ver agenda</span>}
      <ChevronRight size={17}/>
    </div>
  </button>;
}