import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { browserLogin } from './helpers';

type E2EState={patientId:string};
const readState=async()=>JSON.parse(await fs.readFile('.e2e-state.json','utf8')) as E2EState;

test('clinical binary UX keeps contextual notes clear and compacts procedure cards',async({page})=>{
 const seeded=await readState();await browserLogin(page);await page.goto(`/pacientes/${seeded.patientId}/anamnese`);await expect(page.getByText('Condições de Saúde')).toBeVisible();
 await expect(page.getByText('Não resp.',{exact:true})).toHaveCount(0);await expect(page.getByText('Não respondido',{exact:true})).toHaveCount(0);

 const hypertension=page.locator('#q-conditions-hipertensao');const hypertensionYes=hypertension.getByRole('radio',{name:'Sim'});const hypertensionNo=hypertension.getByRole('radio',{name:'Não'});await expect(hypertensionYes).toBeVisible();await expect(hypertensionNo).toBeVisible();
 await hypertensionYes.click();const hypertensionNote=hypertension.locator('textarea');await expect(hypertensionNote).toBeVisible();await hypertensionNote.fill('Observação preservada');await hypertensionNo.click();await expect(hypertension.locator('textarea')).toHaveCount(0);await hypertensionYes.click();await expect(hypertension.locator('textarea')).toHaveValue('Observação preservada');

 await expect(page.locator('#q-surgicalHistory-intestino_regular')).toHaveCount(0);await expect(page.getByText('Ansiedade',{exact:true})).toHaveCount(0);await expect(page.getByText('Estresse elevado',{exact:true})).toHaveCount(0);await expect(page.locator('#history-observations')).toBeVisible();

 const cycle=page.locator('#q-surgicalHistory-menstruacao_regular');const cycleNote=cycle.locator('textarea');await expect(cycleNote).toBeVisible();await cycle.getByRole('radio',{name:'Não'}).click();await expect(cycleNote).toBeVisible();await cycleNote.fill('Fluxo irregular nos últimos meses');await cycle.getByRole('radio',{name:'Sim'}).click();await expect(cycleNote).toHaveValue('Fluxo irregular nos últimos meses');

 const food=page.locator('#food');await expect(food.getByText('Junk food (comida porcaria)',{exact:true})).toBeVisible();await expect(food.getByText('Frituras',{exact:true})).toHaveCount(0);const junkFood=page.locator('#q-habits-fast_food');await expect(junkFood.locator('textarea')).toHaveCount(0);for(const label of['Diário','Semanal','Ocasional','Nunca'])await expect(junkFood.getByRole('radio',{name:label})).toBeVisible();await junkFood.getByRole('radio',{name:'Semanal'}).click();await expect(junkFood.getByRole('radio',{name:'Semanal'})).toHaveAttribute('aria-checked','true');await expect(page.locator('#food-observations')).toBeVisible();

 const procedures=page.locator('#procedures');const limpeza=page.locator('#q-aesthetics-limpeza_pele');const limpezaYes=limpeza.getByRole('radio',{name:'Sim'});const limpezaNo=limpeza.getByRole('radio',{name:'Não'});const limpezaNote=limpeza.locator('textarea');await expect(procedures.getByText('Limpeza de pele',{exact:true})).toBeVisible();await expect(limpezaNote).toBeVisible();const procedureOrder=await limpeza.evaluate(node=>Array.from(node.children).map(child=>String(child.className)));expect(procedureOrder[0]).toContain('anamnesis-procedure-card__header');expect(procedureOrder[1]).toContain('anamnesis-inline-observation');await expect(limpeza.locator('.anamnesis-procedure-card__header').getByText('Limpeza de pele',{exact:true})).toBeVisible();await limpezaNote.fill('Algumas vezes, faz mais de ano');await limpezaNo.click();await expect(limpezaNote).toBeVisible();await expect(limpezaNote).toHaveValue('Algumas vezes, faz mais de ano');await limpezaYes.click();await expect(limpezaNote).toBeVisible();await expect(procedures.locator('input[type="date"]')).toHaveCount(0);await expect(page.locator('#procedures-observations')).toBeVisible();
 await expect(page.getByLabel('Pele da paciente')).toBeVisible();await expect(page.getByLabel('Observações gerais')).toBeVisible();await expect(page.getByLabel('Minhas recomendações')).toBeVisible();
});

test('new patient draft survives backdrop, ESC and explicit close guard',async({page})=>{
 await browserLogin(page);await page.goto('/pacientes');await page.getByRole('button',{name:'Nova paciente'}).click();const dialog=page.getByRole('dialog',{name:'Nova Paciente'});await expect(dialog).toBeVisible();const name=page.getByPlaceholder('Nome completo');await name.fill('Paciente ainda não salva');
 await page.locator('[data-testid="new-patient-backdrop"]').click({position:{x:4,y:4}});await expect(dialog).toBeVisible();await expect(name).toHaveValue('Paciente ainda não salva');
 await page.keyboard.press('Escape');await expect(page.getByText('Descartar cadastro?')).toBeVisible();await page.getByRole('button',{name:'Continuar preenchendo'}).click();await expect(dialog).toBeVisible();await expect(name).toHaveValue('Paciente ainda não salva');
 await page.getByRole('button',{name:'Fechar cadastro'}).click();await expect(page.getByText('Descartar cadastro?')).toBeVisible();await page.getByRole('button',{name:'Continuar preenchendo'}).click();await expect(name).toHaveValue('Paciente ainda não salva');
});

test('anamnesis remains touch-usable on iPad and iPhone widths',async({page})=>{
 const seeded=await readState();await browserLogin(page);for(const viewport of[{width:1024,height:1366},{width:1366,height:1024},{width:390,height:844}]){await page.setViewportSize(viewport);await page.goto(`/pacientes/${seeded.patientId}/anamnese`);const hypertension=page.locator('#q-conditions-hipertensao');const sim=hypertension.getByRole('radio',{name:'Sim'});await expect(sim).toBeVisible();const box=await sim.boundingBox();expect(box?.height??0).toBeGreaterThanOrEqual(44);await sim.click();await expect(hypertension.locator('textarea')).toBeVisible();}}
);
