-- ============================================================
-- AGMX V2 — Sprint 5: Atomic Payment Settlement
-- Ensures payment, invoice and assessment state transitions
-- occur in a single transaction with idempotency and explicit
-- tenant authorization.
--
-- Why a function and not three Edge Function updates:
-- handlePaymentManualConfirm used to update payments, then
-- invoices, then agm_assessments as three separate statements.
-- A failure between them left a payment marked paid while its
-- invoice stayed unpaid — a state no reconciliation could read.
-- One function makes the three writes all-or-nothing.
--
-- Why the operator's organisation is a parameter and not
-- inferred: the Edge Function connects with the service-role
-- key, which bypasses row-level security and carries no
-- auth.uid(). The caller's organisation is therefore supplied
-- by the Edge Function, which has already resolved it from the
-- signed-in user's profiles row, and is compared here against
-- the payment's own organisation. A settlement that names
-- another cooperative's payment is refused.
-- ============================================================

-- ------------------------------------------------------------
-- RPC: atomic payment settlement (operator-supervised)
-- ------------------------------------------------------------
create or replace function public.atomic_settlement(
  p_payment_id   uuid,
  p_operator_org uuid,
  p_actor        uuid,
  p_paid_at      timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_payment   public.payments%rowtype;
  v_invoice   public.invoices%rowtype;
  v_org       uuid;
  v_paid_at   timestamptz := coalesce(p_paid_at, now());
  v_assessment_id uuid;
begin
  -- The operator must be identified. A null organisation would match
  -- nothing below, but saying so beats a silent no-op.
  if p_operator_org is null then
    return jsonb_build_object('error', 'Operator organisation required');
  end if;

  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then
    return jsonb_build_object('error', 'Payment not found');
  end if;

  -- Tenant boundary. The payment carries its own organisation; the
  -- caller carries theirs. They must be the same row.
  if v_payment.organization_id is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;

  v_org := v_payment.organization_id;

  -- Idempotency: a repeated confirmation returns the settled state
  -- instead of writing again, so a retried request cannot double-settle.
  if v_payment.status = 'succeeded' then
    return jsonb_build_object(
      'already_settled', true,
      'payment_id', v_payment.id,
      'status', v_payment.status,
      'paid_at', v_payment.paid_at,
      'invoice_id', v_payment.invoice_id,
      'organization_id', v_org
    );
  end if;

  select * into v_invoice from public.invoices where id = v_payment.invoice_id for update;
  if not found then
    return jsonb_build_object('error', 'Invoice not found for payment');
  end if;

  -- The invoice must belong to the same cooperative as the payment.
  -- A payment row alone is not enough: an operator must not be able to
  -- settle an invoice they do not own by naming its payment.
  if v_invoice.organization_id is distinct from p_operator_org then
    return jsonb_build_object('error', 'Forbidden', 'code', 'FORBIDDEN');
  end if;

  -- 1. payment
  update public.payments
     set status = 'succeeded', paid_at = v_paid_at
   where id = p_payment_id;

  -- 2. invoice
  update public.invoices
     set status = 'paid', paid_at = v_paid_at
   where id = v_payment.invoice_id;

  -- 3. assessment, reached through the invoice's quote. agm_assessments
  --    has no paid_at column, so only its status moves.
  if v_invoice.quote_id is not null then
    select assessment_id into v_assessment_id
      from public.quotes where id = v_invoice.quote_id;
    if v_assessment_id is not null then
      update public.agm_assessments
         set status = 'paid'
       where id = v_assessment_id;
    end if;
  end if;

  perform public.log_audit(
    v_org,
    p_actor,
    'payment.succeeded',
    'payment',
    p_payment_id::text,
    jsonb_build_object(
      'invoiceId', v_invoice.id,
      'method', v_payment.method,
      'amount', v_payment.amount,
      'reference', v_payment.reference,
      'confirmedBy', 'operator'
    )
  );

  return jsonb_build_object(
    'settled', true,
    'payment_id', p_payment_id,
    'status', 'succeeded',
    'paid_at', v_paid_at,
    'invoice_id', v_invoice.id,
    'organization_id', v_org,
    'amount', v_payment.amount,
    'method', v_payment.method
  );
end;
$$;

revoke execute on function public.atomic_settlement(uuid, uuid, uuid, timestamptz) from public, anon;
grant execute on function public.atomic_settlement(uuid, uuid, uuid, timestamptz) to service_role;