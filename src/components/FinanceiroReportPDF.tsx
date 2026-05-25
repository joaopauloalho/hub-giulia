import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { FinanceiroSummary } from '../hooks/useFinanceiro';
import type { Procedure, Service } from '../types';

const styles = StyleSheet.create({
  page: { padding: 32, fontFamily: 'Helvetica', fontSize: 9, color: '#222' },
  header: { marginBottom: 18, borderBottom: '1px solid #eee', paddingBottom: 10 },
  title: { fontSize: 17, fontWeight: 'bold', color: '#be185d' },
  sub: { marginTop: 4, color: '#666' },
  cards: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  card: { flex: 1, border: '1px solid #eee', padding: 8, borderRadius: 6 },
  label: { color: '#777', fontSize: 8 },
  value: { marginTop: 4, fontSize: 11, fontWeight: 'bold' },
  tableHeader: { flexDirection: 'row', backgroundColor: '#fff5f7', padding: 6, fontWeight: 'bold' },
  row: { flexDirection: 'row', padding: 6, borderBottom: '1px solid #f2f2f2' },
  cDate: { width: '15%' },
  cPatient: { width: '23%' },
  cService: { width: '28%' },
  cMethod: { width: '14%' },
  cMoney: { width: '10%', textAlign: 'right' },
  footer: { marginTop: 16, paddingTop: 10, borderTop: '1px solid #eee', textAlign: 'right', fontWeight: 'bold' },
});

const PAYMENT_LABELS: Record<string, string> = {
  dinheiro: 'Dinheiro',
  cartao_credito: 'Credito',
  cartao_debito: 'Debito',
  pix: 'PIX',
  pix_parcelado: 'PIX parcelado',
  split: 'Dividido',
};

function currency(value: number) {
  return `R$ ${value.toFixed(2)}`;
}

function serviceNames(proc: Procedure, services: Service[]) {
  const names = proc.services_ids.map(id => services.find(service => service.id === id)?.name).filter(Boolean);
  return names.length > 0 ? names.join(', ') : 'Servicos registrados';
}

export function FinanceiroReportPDF({ month, summary, procedures, services }: {
  month: Date;
  summary: FinanceiroSummary;
  procedures: Procedure[];
  services: Service[];
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Relatorio financeiro</Text>
          <Text style={styles.sub}>{format(month, 'MMMM yyyy', { locale: ptBR })} - gerado em {format(new Date(), 'dd/MM/yyyy HH:mm')}</Text>
        </View>

        <View style={styles.cards}>
          {[
            ['Receita', summary.receitaTotal],
            ['Recebido', summary.recebido],
            ['Pendente', summary.pendente],
            ['Custos', summary.custos],
            ['Lucro', summary.lucro],
          ].map(([label, value]) => (
            <View key={label} style={styles.card}>
              <Text style={styles.label}>{label}</Text>
              <Text style={styles.value}>{currency(value as number)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.tableHeader}>
          <Text style={styles.cDate}>Data</Text>
          <Text style={styles.cPatient}>Paciente</Text>
          <Text style={styles.cService}>Servicos</Text>
          <Text style={styles.cMethod}>Metodo</Text>
          <Text style={styles.cMoney}>Valor</Text>
          <Text style={styles.cMoney}>Lucro</Text>
        </View>
        {procedures.map(proc => (
          <View key={proc.id} style={styles.row}>
            <Text style={styles.cDate}>{format(new Date(proc.performed_at), 'dd/MM/yyyy')}</Text>
            <Text style={styles.cPatient}>{proc.patient?.name ?? 'Paciente'}</Text>
            <Text style={styles.cService}>{serviceNames(proc, services)}</Text>
            <Text style={styles.cMethod}>{PAYMENT_LABELS[proc.payment_method] ?? proc.payment_method}</Text>
            <Text style={styles.cMoney}>{currency(proc.total_value)}</Text>
            <Text style={styles.cMoney}>{currency(proc.net_value - proc.total_cost)}</Text>
          </View>
        ))}

        <Text style={styles.footer}>Total: {currency(summary.receitaTotal)} - Lucro: {currency(summary.lucro)}</Text>
      </Page>
    </Document>
  );
}
