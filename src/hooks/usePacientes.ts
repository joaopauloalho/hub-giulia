import { useState, useEffect, useCallback } from 'react';
import type { Paciente } from '../types';

const KEY = 'hub-giulia-pacientes';

function load(): Paciente[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

function save(list: Paciente[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function usePacientes() {
  const [pacientes, setPacientes] = useState<Paciente[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    setPacientes(load().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const create = (data: Omit<Paciente, 'id' | 'createdAt'>) => {
    const novo: Paciente = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };
    const list = load();
    save([novo, ...list]);
    refresh();
    return novo;
  };

  const update = (id: string, data: Partial<Omit<Paciente, 'id' | 'createdAt'>>) => {
    const list = load().map(p => p.id === id ? { ...p, ...data } : p);
    save(list);
    refresh();
  };

  const remove = (id: string) => {
    save(load().filter(p => p.id !== id));
    refresh();
  };

  const getById = (id: string) => load().find(p => p.id === id) ?? null;

  return { pacientes, loading, create, update, remove, getById, refresh };
}
