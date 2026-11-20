import { z } from 'zod';
import { badRequest, notFound } from '../lib/errors.js';
import { getTicket, listTickets, updateTicketItemStatus, updateTicketStatus } from '../lib/kds-service.js';

const TicketQuery = z.object({
  outletId: z.string().uuid().optional(),
  status: z.enum(['queued', 'in_preparation', 'ready', 'served', 'cancelled']).optional(),
  stationCode: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  cursor: z.string().optional()
});
const StatusBody = z.object({
  status: z.enum(['queued', 'in_preparation', 'ready', 'served', 'cancelled']),
  reason: z.string().max(500).nullable().optional()
});

export async function kdsRoutes(app) {
  app.get('/kds/tickets', {
    preHandler: [app.authenticate, app.requirePermission('kds.ticket.read')]
  }, async (request) => {
    const parsed = TicketQuery.safeParse(request.query);
    if (!parsed.success) throw badRequest('Parameter KDS tidak valid.', parsed.error.issues);
    if (parsed.data.outletId && parsed.data.outletId !== request.gcims.outletId) throw notFound('Outlet tidak ditemukan.');
    return listTickets({
      companyId: request.gcims.companyId,
      outletId: request.gcims.outletId,
      status: parsed.data.status,
      stationCode: parsed.data.stationCode,
      limit: parsed.data.limit,
      cursor: parsed.data.cursor
    });
  });

  app.get('/kds/tickets/:ticketId', {
    preHandler: [app.authenticate, app.requirePermission('kds.ticket.read')]
  }, async (request) => getTicket({ ...request.gcims, ticketId: request.params.ticketId }));

  app.patch('/kds/tickets/:ticketId/status', {
    preHandler: [app.authenticate, app.requirePermission('kds.ticket.update')]
  }, async (request) => {
    const parsed = StatusBody.safeParse(request.body);
    if (!parsed.success) throw badRequest('Payload status tiket tidak valid.', parsed.error.issues);
    return updateTicketStatus({
      ...request.gcims, ticketId: request.params.ticketId,
      userId: request.gcims.userId, ...parsed.data
    });
  });

  app.patch('/kds/tickets/:ticketId/items/:ticketItemId/status', {
    preHandler: [app.authenticate, app.requirePermission('kds.ticket.update')]
  }, async (request) => {
    const parsed = StatusBody.safeParse(request.body);
    if (!parsed.success) throw badRequest('Payload status item tidak valid.', parsed.error.issues);
    return updateTicketItemStatus({
      ...request.gcims, ticketId: request.params.ticketId,
      ticketItemId: request.params.ticketItemId,
      userId: request.gcims.userId, ...parsed.data
    });
  });
}
