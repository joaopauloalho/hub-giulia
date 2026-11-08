import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export type IcloudImportedEvent = {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  is_all_day: boolean;
  is_private: boolean;
  is_deleted: boolean;
  review_state: 'pending' | 'personal' | 'dismissed';
  linked_patient_id: string | null;
  linked_appointment_id: string | null;
};

export function useIcloudEvents({from,to,revision}:{
  from:string;to:string;revision:number;
}) {
  const [events,setEvents]=useState<IcloudImportedEvent[]>([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState<string|null>(null);

  useEffect(()=>{
    let disposed=false;
    const load=async()=>{
      setLoading(true);
      const {data:collections,error:collectionsError}=await supabase
        .from('icloud_calendar_collections').select('calendar_id')
        .eq('is_selected',true);
      if(collectionsError){
        if(!disposed){setEvents([]);setError(collectionsError.message);setLoading(false);}
        return;
      }
      const selected=(collections??[]).map(row=>row.calendar_id);
      if(!selected.length){
        if(!disposed){setEvents([]);setError(null);setLoading(false);}
        return;
      }
      const {data,error:queryError}=await supabase.from('icloud_calendar_events')
        .select('id,title,starts_at,ends_at,is_all_day,is_private,is_deleted,review_state,linked_patient_id,linked_appointment_id')
        .in('calendar_id',selected).lt('starts_at',to).gt('ends_at',from)
        .order('starts_at').limit(1000);
      if(disposed)return;
      setLoading(false);
      if(queryError) {
        setEvents([]);
        setError(queryError.message);
      } else {
        setEvents((data??[]) as IcloudImportedEvent[]);
        setError(null);
      }
    };
    void load();
    return()=>{disposed=true;};
  },[from,to,revision]);

  return {events,loading,error};
}
