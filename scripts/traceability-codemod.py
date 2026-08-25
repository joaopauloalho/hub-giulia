from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


registrar_path = Path('src/pages/registrar/RegistrarPage.tsx')
registrar = registrar_path.read_text()

registrar = replace_once(
    registrar,
    "material_entries: selectedMaterials.map(item => ({ material_id: item.material_id, quantity: item.quantity })),",
    "material_entries: selectedMaterials.map(item => ({ material_id: item.material_id, quantity: item.quantity, traceability: item.material.traceability_mode === 'none' ? null : { lot_number: item.traceability?.lot_number?.trim() || null, expires_on: item.traceability?.expires_on || null, evidence_upload_id: item.evidence?.id ?? item.traceability?.evidence_upload_id ?? null } })),",
    'attendance material payload',
)

registrar = replace_once(
    registrar,
    "{step === 2 && <MaterialsStep selected={selectedMaterials} onChange={setSelectedMaterials}/>} ",
    "{step === 2 && patient && <MaterialsStep patientId={patient.id} selected={selectedMaterials} onChange={setSelectedMaterials}/>} ",
    'materials step patient',
)

materials_line = re.compile(r"^(\s*\{materials\.length > 0 && <div style=\{\{ padding: '12px 16px', borderBottom: '1px solid var\(--border\)' \}\}>.*?</div>\})$", re.MULTILINE)
match = materials_line.search(registrar)
if not match:
    raise SystemExit('confirmation materials block not found')
trace_summary = """
    {materials.some(item => item.material.traceability_mode !== 'none' && (item.traceability?.lot_number || item.traceability?.expires_on || item.evidence)) && <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}><div style={{ fontSize: '0.72rem', color: 'var(--text-3)', marginBottom: 7, fontWeight: 700 }}>RASTREABILIDADE</div>{materials.filter(item => item.material.traceability_mode !== 'none' && (item.traceability?.lot_number || item.traceability?.expires_on || item.evidence)).map(item => <div key={`trace-${item.material_id}`} style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}><div style={{ fontWeight: 700, fontSize: '0.84rem' }}>{item.material.name}</div><div style={{ fontSize: '0.76rem', color: 'var(--text-2)', marginTop: 3, display: 'flex', gap: 9, flexWrap: 'wrap' }}><span>{item.quantity.toLocaleString('pt-BR',{maximumFractionDigits:3})} {item.material.unit_label}</span>{item.traceability?.lot_number && <span>Lote <strong>{item.traceability.lot_number}</strong></span>}{item.traceability?.expires_on && <span>Val. <strong>{item.traceability.expires_on.split('-').reverse().join('/')}</strong></span>}{item.evidence && <span>📷 1 foto anexada</span>}</div></div>)}</div>}
""".rstrip('\n')
registrar = registrar[:match.end()] + '\n' + trace_summary + registrar[match.end():]
registrar_path.write_text(registrar)

injectables_path = Path('src/pages/registrar/InjetaveisScreen.tsx')
injectables = injectables_path.read_text()
injectables = replace_once(
    injectables,
    "import { InjetaveisFaceMap, type FaceMapPoint } from '../../components/InjetaveisFaceMap';",
    "import { InjetaveisFaceMap, type FaceMapPoint } from '../../components/InjetaveisFaceMap';\nimport { InjectableTraceabilityPanel } from './InjectableTraceabilityPanel';",
    'injectables traceability import',
)

injectables = replace_once(
    injectables,
    "                <label>Observação de diluição (opcional)</label>",
    "                {draft && activeProduct && <InjectableTraceabilityPanel patientId={patientId} mapId={draft.id} applicationId={activeApplication.id} productName={activeProduct.name} lotNumber={activeLot?.lot_number ?? null} expiresOn={activeLot?.expires_on ?? null} />}\n                <label>Observação de diluição (opcional)</label>",
    'injectables traceability panel',
)
injectables_path.write_text(injectables)
