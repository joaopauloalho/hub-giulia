export interface Material {
  id: string;
  user_id: string;
  name: string;
  unit_label: string;
  unit_cost: number;
  stock_quantity: number;
  minimum_stock: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProcedureMaterialInput {
  material_id: string;
  quantity: number;
}

export interface ProcedureMaterial {
  id: string;
  user_id: string;
  procedure_id: string;
  material_id: string;
  material_name_snapshot: string;
  unit_label_snapshot: string;
  quantity: number;
  unit_cost_snapshot: number;
  total_cost_snapshot: number;
  created_at: string;
}

export interface InventoryMovement {
  id: string;
  user_id: string;
  material_id: string;
  movement_type: 'initial_stock' | 'stock_entry' | 'manual_adjustment' | 'procedure_consumption' | 'procedure_reversal';
  quantity_delta: number;
  unit_cost_snapshot: number | null;
  procedure_id: string | null;
  procedure_id_snapshot: string | null;
  procedure_material_id: string | null;
  procedure_material_id_snapshot: string | null;
  reason: string | null;
  idempotency_key: string | null;
  created_at: string;
  created_by: string | null;
}

export interface MaterialDraft {
  name: string;
  unit_label: string;
  unit_cost: number;
  initial_stock: number;
  minimum_stock: number;
  active: boolean;
}
