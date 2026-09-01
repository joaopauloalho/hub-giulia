import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { TreatmentProposalItem, TreatmentProposalVersion } from '../../lib/proposals';
import { proposalDate, proposalMoney } from '../../lib/proposals';

const styles = StyleSheet.create({
  page: { padding: 42, fontFamily: 'Helvetica', fontSize: 10, color: '#28262b' },
  eyebrow: { fontSize: 8, color: '#777078', letterSpacing: 1.2, marginBottom: 8, textTransform: 'uppercase' },
  title: { fontSize: 22, fontWeight: 700, marginBottom: 5 },
  recipient: { fontSize: 11, color: '#5f5962', marginBottom: 22 },
  metaRow: { display: 'flex', flexDirection: 'row', gap: 18, paddingBottom: 14, marginBottom: 14, borderBottom: '1px solid #e8e4e8' },
  meta: { fontSize: 9, color: '#6e6870' },
  row: { padding: '11 0', borderBottom: '1px solid #efecf0' },
  rowHead: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  name: { width: '68%', paddingRight: 8, fontWeight: 700 },
  total: { width: '32%', textAlign: 'right', fontWeight: 700 },
  detail: { fontSize: 8.5, color: '#777078', marginTop: 4, lineHeight: 1.35 },
  condition: { fontSize: 8.5, color: '#514b53', marginTop: 5, lineHeight: 1.35 },
  summary: { marginLeft: 'auto', width: 250, marginTop: 20 },
  totalRow: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', marginTop: 7, paddingTop: 10, borderTop: '1px solid #9e969f', fontSize: 14, fontWeight: 700 },
  section: { marginTop: 24 }, sectionTitle: { fontSize: 8, color: '#777078', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }, body: { fontSize: 9.5, lineHeight: 1.5 },
  footer: { marginTop: 30, paddingTop: 14, borderTop: '1px solid #e8e4e8', fontSize: 8.5, color: '#777078' },
});

export function ProposalPDF({ version, items }: { version: TreatmentProposalVersion; items: TreatmentProposalItem[] }) {
  const recipient = version.recipient_snapshot?.name ?? 'Cliente'; const professional = version.professional_snapshot;
  return <Document title={version.title} author={professional?.display_name ?? 'Hub Giulia'}>
    <Page size="A4" style={styles.page}>
      <Text style={styles.eyebrow}>Proposta comercial</Text>
      <Text style={styles.title}>{version.title}</Text>
      <Text style={styles.recipient}>{recipient}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.meta}>Data: {version.issued_at ? new Date(version.issued_at).toLocaleDateString('pt-BR') : new Date().toLocaleDateString('pt-BR')}</Text>
        <Text style={styles.meta}>Validade: {proposalDate(version.valid_until)}</Text>
      </View>

      {items.map(item => <View style={styles.row} key={item.id}>
        <View style={styles.rowHead}><Text style={styles.name}>{item.service_name_snapshot}</Text><Text style={styles.total}>{proposalMoney(item.line_total)}</Text></View>
        {item.payment_condition && <Text style={styles.condition}>Condição de pagamento: {item.payment_condition}</Text>}
        {item.interval_note && <Text style={styles.detail}>{item.interval_note}</Text>}
        {item.description_snapshot && <Text style={styles.detail}>{item.description_snapshot}</Text>}
      </View>)}

      <View style={styles.summary}><View style={styles.totalRow}><Text>Total da proposta</Text><Text>{proposalMoney(version.total_value)}</Text></View></View>
      {version.customer_note && <View style={styles.section}><Text style={styles.sectionTitle}>Observações</Text><Text style={styles.body}>{version.customer_note}</Text></View>}

      <View style={styles.footer}>
        {professional?.display_name && <Text>{professional.display_name}{professional.profession ? ` · ${professional.profession}` : ''}{professional.professional_registration ? ` · ${professional.professional_registration}` : ''}</Text>}
        <Text>Esta proposta apresenta condições comerciais e não substitui avaliação ou orientação clínica.</Text>
      </View>
    </Page>
  </Document>;
}
