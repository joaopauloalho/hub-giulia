import fs from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { browserLogin } from './helpers';

type E2EState={patientId:string};
const readState=async()=>JSON.parse(await fs.readFile('.e2e-state.json','utf8')) as E2EState;

test('clinical binary UX shows regular notes only after Sim and keeps procedure notes always open',async({page})=>{
 const seeded=await readState();await browserLogin(page);await page.goto(`/pacientes/${seeded.patientId}/anamnese`);await expect(page.getByText('Condições de Saúde')).toBeVisible();
 await expect(page.getByText('Não resp.',{exact:true})).toHaveCount(0);await expect(page.getByText('Não respondido',{exact:true})).toHaveCount(0);

 const hypertension=page.locator('#q-conditions-hipertensao');const hypertensionYes=hypertension.getByRole('radio',{name:'Sim'});const hypertensionNo=hypertension.getByRole('radio',{name:'Não'});await expect(hypertensionYes).toBeVisible();await expect(hypertensionNo).toBeVisible();
 await hypertensionYes.click();const hypertensionNote=hypertension.locator('textarea');await expect(hypertensionNote).toBeVisible();await hypertensionNote.fill('Observação preservada');await hypertensionNo.click();await expect(hypertension.locator('textarea')).toHaveCount(0);await hypertensionYes.click();await expect(hypertension.locator('textarea')).toHaveValue('Observação preservada');

 const intestine=page.locator('#q-surgicalHistory-intestino_regular');const intestineYes=intestine.getByRole('radio',{name:'Sim'});const intestineNo=intestine.getByRole('radio',{name:'Não'});await intestineNo.click();await expect(intestine.locator('textarea')).toHaveCount(0);await intestineYes.click();await expect(intestine.locator('textarea')).toBeVisible();await intestineNo.click();await expect(intestine.locator('textarea')).toHaveCount(0);await expect(page.locator('#history-observations')).toBeVisible();

 const procedures=page.locator('#procedures');const limpeza=page.locator('#q-aesthetics-limpeza_pele');const limpezaYes=limpeza.getByRole('radio',{name:'Sim'});const limpezaNo=limpeza.getByRole('radio',{name:'Não'});const limpezaNote=limpeza.locator('textarea');await expect(procedures.getByText('Limpeza de pele',{exact:true})).toBeVisible();await expect(limpezaNote).toBeVisible();await limpezaNote.fill('Algumas vezes, faz mais de ano');await limpezaNo.click();await expect(limpezaNote).toBeVisible();await expect(limpezaNote).toHaveValue('Algumas vezes, faz mais de ano');await limpezaYes.click();await expect(limpezaNote).toBeVisible();await expect(procedures.locator('input[type="date"]')).toHaveCount(0);await expect(page.locator('#procedures-observations')).toBeVisible();
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
