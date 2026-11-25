import { readFile } from 'node:fs/promises';

const posHtml = new URL('../../public/pos.html', import.meta.url);
const loginHtml = new URL('../../public/login.html', import.meta.url);
const loginCss = new URL('../../public/login.css', import.meta.url);
const loginJs = new URL('../../public/login.js', import.meta.url);
const posCss = new URL('../../public/pos.css', import.meta.url);
const posJs = new URL('../../public/pos.js', import.meta.url);
const adminHtml = new URL('../../public/admin.html', import.meta.url);
const adminCss = new URL('../../public/admin.css', import.meta.url);
const adminJs = new URL('../../public/admin.js', import.meta.url);
const cashierStockHtml = new URL('../../public/cashier-stock.html', import.meta.url);
const cashierStockCss = new URL('../../public/cashier-stock.css', import.meta.url);
const cashierStockJs = new URL('../../public/cashier-stock.js', import.meta.url);
const brandLogo = new URL('../../public/pos-assets/gourmets-logo.png', import.meta.url);
const productImages = new Map([
  ['caramel-macchiato', new URL('../../public/pos-assets/caramel-macchiato.jpg', import.meta.url)],
  ['latte', new URL('../../public/pos-assets/latte.jpg', import.meta.url)],
  ['americano', new URL('../../public/pos-assets/americano.jpg', import.meta.url)],
  ['cappuccino', new URL('../../public/pos-assets/cappuccino.jpg', import.meta.url)],
  ['flat-white', new URL('../../public/pos-assets/flat-white.jpg', import.meta.url)],
  ['kopi-susu', new URL('../../public/pos-assets/kopi-susu.jpg', import.meta.url)]
]);

export async function uiRoutes(app) {
  for (const route of ['/', '/login']) {
    app.get(route, async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      return reply.type('text/html; charset=utf-8').send(await readFile(loginHtml));
    });
  }

  app.get('/login.css', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return reply.type('text/css; charset=utf-8').send(await readFile(loginCss));
  });

  app.get('/login.js', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return reply.type('application/javascript; charset=utf-8').send(await readFile(loginJs));
  });

  app.get('/pos', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return reply.type('text/html; charset=utf-8').send(await readFile(posHtml));
  });

  app.get('/pos/stock', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return reply.type('text/html; charset=utf-8').send(await readFile(cashierStockHtml));
  });

  app.get('/cashier-stock.css', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return reply.type('text/css; charset=utf-8').send(await readFile(cashierStockCss));
  });

  app.get('/cashier-stock.js', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return reply.type('application/javascript; charset=utf-8').send(await readFile(cashierStockJs));
  });

  for (const route of ['/admin', '/admin/inventory', '/admin/ledger', '/admin/stocktakes', '/admin/menus', '/admin/cashiers', '/admin/sales', '/admin/shifts']) {
    app.get(route, async (_request, reply) => {
      reply.header('cache-control', 'no-store');
      return reply.type('text/html; charset=utf-8').send(await readFile(adminHtml));
    });
  }

  app.get('/admin.css', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return reply.type('text/css; charset=utf-8').send(await readFile(adminCss));
  });

  app.get('/admin.js', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return reply.type('application/javascript; charset=utf-8').send(await readFile(adminJs));
  });

  app.get('/pos.css', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return reply.type('text/css; charset=utf-8').send(await readFile(posCss));
  });

  app.get('/pos.js', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return reply.type('application/javascript; charset=utf-8').send(await readFile(posJs));
  });

  app.get('/pos-assets/:asset', async (request, reply) => {
    if (request.params.asset === 'gourmets-logo.png') {
      reply.header('cache-control', 'public, max-age=86400');
      return reply.type('image/png').send(await readFile(brandLogo));
    }
    const image = productImages.get(request.params.asset.replace(/\.jpg$/i, ''));
    if (!image) return reply.code(404).send({ error: 'Asset tidak ditemukan.' });
    reply.header('cache-control', 'public, max-age=86400');
    return reply.type('image/jpeg').send(await readFile(image));
  });
}
