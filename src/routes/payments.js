import { z } from 'zod';
import { badRequest, notFound } from '../lib/errors.js';
import { cancelPendingPayment, createCashPayment, getPayment, getReceipt } from '../lib/payment-service.js';

const CreatePayment = z.object({
  method: z.enum(['cash', 'qris', 'card', 'bank_transfer', 'other']),
  amount: z.number().int().positive(),
  cash_received_amount: z.number().int().nonnegative().optional(),
  provider_code: z.string().max(60).nullable().optional()
});
const CancelPayment = z.object({ reason: z.string().max(500).optional() });

export async function paymentRoutes(app) {
  app.post('/orders/:orderId/payments', {
    preHandler: [app.authenticate, app.requirePermission('pos.payment.create')]
  }, async (request, reply) => {
    const parsed = CreatePayment.safeParse(request.body);
    if (!parsed.success) throw badRequest('Payload pembayaran tidak valid.', parsed.error.issues);
    const result = await createCashPayment({
      ...request.gcims, orderId: request.params.orderId,
      userId: request.gcims.userId,
      idempotencyKey: request.headers['idempotency-key'], body: parsed.data
    });
    return reply.code(result.replay ? 200 : 201).send(result.payment);
  });

  app.get('/payments/:paymentId', {
    preHandler: [app.authenticate, app.requirePermission('pos.payment.read')]
  }, async (request) => getPayment({ ...request.gcims, paymentId: request.params.paymentId }));

  app.post('/payments/:paymentId/cancel', {
    preHandler: [app.authenticate, app.requirePermission('pos.payment.cancel')]
  }, async (request) => {
    const parsed = CancelPayment.safeParse(request.body ?? {});
    if (!parsed.success) throw badRequest('Payload pembatalan tidak valid.', parsed.error.issues);
    return cancelPendingPayment({ ...request.gcims, paymentId: request.params.paymentId, reason: parsed.data.reason });
  });

  app.get('/orders/:orderId/receipt', {
    preHandler: [app.authenticate, app.requirePermission('pos.receipt.read')]
  }, async (request) => getReceipt({ ...request.gcims, orderId: request.params.orderId }));

  // Provider-specific signature verification must be supplied by the selected payment gateway.
  app.post('/webhooks/payments/:providerCode', async (request, reply) => {
    request.log.warn({ providerCode: request.params.providerCode }, 'Payment webhook received but no provider adapter is configured');
    return reply.code(501).send({
      error: {
        code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
        message: 'Webhook belum diaktifkan. Pilih provider dan implementasikan verifikasi signature sebelum menerima callback.',
        request_id: request.id,
        details: []
      }
    });
  });
}
