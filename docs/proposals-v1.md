# Hub Giulia 3.1 — Proposals V1

## Source of truth

A commercial proposal is not a CRM Deal and is not a performed Procedure.

- `treatment_proposals` identifies the logical commercial proposal and belongs to a Deal.
- `treatment_proposal_versions` stores each commercial version presented to the contact.
- `treatment_proposal_items` stores the historical item snapshots used by that version.

Historic versions never read current catalog names or prices to reconstruct what was offered.

## Lifecycle

`draft → issued → accepted | declined | voided`

Expiration is derived when an `issued` version has `valid_until` before the clinic date in `America/Sao_Paulo`.

Issued and terminal versions are immutable. Changes require a new draft version. A proposal can have at most one active draft and one accepted version.

## Money

Postgres `NUMERIC` is canonical. The order is:

1. quantity × offered unit price = item subtotal;
2. item discount;
3. sum item totals = net subtotal;
4. global discount;
5. final total.

Discounts support none, amount, and percentage. Totals never rely on browser-supplied aggregate values.

## CRM semantics

Opening a share sheet does not mean the proposal was sent. `sent_at` is explicit.

When marked sent, the Deal value reflects the sent version total and eligible early stages advance to the existing `proposal_sent` stage. Accepting a proposal may optionally mark the Deal won only through the explicit combined action.

Neither proposal acceptance nor Deal won creates Procedures, payments, packages, credits, or appointments.

## Patient and Agenda

Patient history is derived through Proposal → Deal → Contact → Patient, so proposals created while a contact was still only a lead remain visible after conversion.

An accepted proposal can open Agenda 2.0 only after a Patient exists. Multi-item proposals require explicit service selection; sessions are not auto-created.

## Security and artifacts

All proposal tables use RLS. Direct authenticated writes are revoked; transactional RPCs validate `auth.uid()` ownership. Proposal PDFs live in the private `proposals` bucket using an ownership-safe path and are attached once with SHA-256 integrity metadata. Browser sharing uses Web Share when supported and falls back to download.
