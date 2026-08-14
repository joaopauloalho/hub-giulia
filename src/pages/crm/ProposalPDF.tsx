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
  tableHead: { display: 'flex', flexDirection: 'row', padding: '8 0', borderBottom: '1px solid #d8d3d9', fontSize: 8, color: '#777078', textTransform: 'uppercase' },
  row: { display: 'flex', flexDirection: 'row', padding: '10 0', borderBottom: '1px solid #efecf0' },
  name: { width: '42%', paddingRight: 8 },
  qty: { width: '16%' },
  unit: { width: '20%', textAlign: 'right' },
  total: { width: '22%', textAlign: 'right', fontWeight: 700 },
  detail: { fontSize: 8.5, color: '#777078', marginTop: 3, lineHeight: 1.35 },
  summary: { marginLeft: 'auto', width: 250, marginTop: 20 },
  sumRow: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', padding: '4 0', color: '#5f5962' },
  totalRow: { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', marginTop: 7, paddingTop: 10, borderTop: '1px solid #9e969f', fontSize: 14, fontWeight: 700 },
  section: { marginTop: 24 },
  sectionTitle: { fontSize: 8, color: '#777078', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
  body: { fontSize: 9.5, lineHeight: 1.5 },
  footer: { marginTop: 30, paddingTop: 14, borderTop: '1px solid #e8e4e8', fontSize: 8.5, color: '#777078' },
  integrity: { marginTop: 8, fontSize: 6.5, color: '#9a949c' },
});

function qtyLabel(item: TreatmentProposalItem) {
  const quantity = Number(item.quantity);
  const display = Number.isInteger(quantity) ? String(quantity) : String(quantity).replace('.', ',');
  const unit = item.unit_label === 'sessão' && quantity !== 1 ? 'sessões' : item.unit_label;
  return `${display} ${unit}`;
}

export function ProposalPDF({ version, items }: { version: TreatmentProposalVersion; items: TreatmentProposalItem[] }) {
  const recipient = version.recipient_snapshot?.name ?? 'Cliente';
  const professional = version.professional_snapshot;
  return <Document title={version.title} author={professional?.display_name ?? 'Hub Giulia'}>
    <Page size="A4" style={styles.page}>
      <Text style={styles.eyebrow}>Plano de tratamento · Proposta comercial</Text>
      <Text style={styles.title}>{version.title}</Text>
      <Text style={styles.recipient}>{recipient}</Text>
      <View style={styles.metaRow}>
        <Text style={styles.meta}>Versão {version.version_number}</Text>
        <Text style={styles.meta}>Data: {version.issued_at ? new Date(version.issued_at).toLocaleDateString('pt-BR') : '—'}</Text>
        <Text style={styles.meta}>Validade: {proposalDate(version.valid_until)}</Text>
      </View>

      <View style={styles.tableHead}>
        <Text style={styles.name}>Procedimento</Text><Text style={styles.qty}>Quantidade</Text><Text style={styles.unit}>Valor unitário</Text><Text style={styles.total}>Total</Text>
      </View>
      {items.map(item => <View style={styles.row} key={item.id}>
        <View style={styles.name}>
          <Text>{item.service_name_snapshot}</Text>
          {item.description_snapshot && <Text style={styles.detail}>{item.description_snapshot}</Text>}
          {item.interval_note && <Text style={styles.detail}>{item.interval_note}</Text>}
        </View>
        <Text style={styles.qty}>{qtyLabel(item)}</Text>
        <Text style={styles.unit}>{proposalMoney(item.offered_unit_price)}</Text>
        <View style={styles.total}>
          <Text>{proposalMoney(item.line_total)}</Text>
          {Number(item.discount_amount) > 0 && <Text style={styles.detail}>desconto {proposalMoney(item.discount_amount)}</Text>}
        </View>
      </View>)}

      <View style={styles.summary}>
        <View style={styles.sumRow}><Text>Subtotal</Text><Text>{proposalMoney(version.subtotal)}</Text></View>
        {Number(version.item_discount_amount) > 0 && <View style={styles.sumRow}><Text>Descontos nos itens</Text><Text>- {proposalMoney(version.item_discount_amount)}</Text></View>}
        {Number(version.discount_amount) > 0 && <View style={styles.sumRow}><Text>Condição especial</Text><Text>- {proposalMoney(version.discount_amount)}</Text></View>}
        <View style={styles.totalRow}><Text>Total</Text><Text>{proposalMoney(version.total_value)}</Text></View>
      </View>

      {version.payment_terms && <View style={styles.section}><Text style={styles.sectionTitle}>Condições de pagamento</Text><Text style={styles.body}>{version.payment_terms}</Text></View>}
      {version.customer_note && <View style={styles.section}><Text style={styles.sectionTitle}>Observações</Text><Text style={styles.body}>{version.customer_note}</Text></View>}

      <View style={styles.footer}>
        {professional?.display_name && <Text>{professional.display_name}{professional.profession ? ` · ${professional.profession}` : ''}{professional.professional_registration ? ` · ${professional.professional_registration}` : ''}</Text>}
        <Text>Esta proposta apresenta condições comerciais e não substitui avaliação ou orientação clínica.</Text>
        {version.pdf_sha256 && <Text style={styles.integrity}>Integridade técnica do arquivo: SHA-256 {version.pdf_sha256}</Text>}
      </View>
    </Page>
  </Document>;
}
