export interface Contact {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  status: 'active' | 'inactive';
  notes: string | null;
  created_at: string;
}

export interface Deal {
  id: string;
  user_id: string;
  contact_id: string | null;
  title: string;
  value: number | null;
  stage: 'lead' | 'qualified' | 'proposal' | 'won' | 'lost';
  expected_close: string | null;
  created_at: string;
  contact?: Pick<Contact, 'id' | 'name' | 'company'>;
}

export interface Activity {
  id: string;
  user_id: string;
  contact_id: string | null;
  deal_id: string | null;
  type: 'call' | 'email' | 'meeting' | 'note';
  description: string | null;
  scheduled_at: string | null;
  completed: boolean;
  created_at: string;
}

export type DealStage = Deal['stage'];
export type ActivityType = Activity['type'];
