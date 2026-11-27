from pathlib import Path
from playwright.sync_api import sync_playwright

css = Path('public/pos.css').read_text(encoding='utf-8')
html = '''<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>''' + css + '''</style>
<div class="app-shell"><aside class="sidebar"></aside><main class="workspace"><div class="pos-layout"><section></section><aside id="cart-panel" class="cart-panel open">
<header class="cart-heading"><div><h2>Pesanan saat ini</h2><span>Keranjang baru</span></div><div class="cart-heading-actions"><button class="more-button">···</button></div></header>
<div class="order-type-row"><button class="type-button selected">Bawa pulang</button><button class="type-button">Dine-in</button></div>
<label class="location-field">Lokasi stok<select><option>Kemang · KMR</option></select></label>
<div class="cart-lines"><div class="cart-line"><div class="cart-line-top"><span class="cart-line-name">Caramel Macchiato</span><strong class="cart-line-price">Rp38.000</strong></div><div class="cart-line-meta">CM-R | Regular</div><div class="cart-line-controls"><div class="quantity-control"><button>−</button><span>1</span><button>+</button></div><input class="line-note" placeholder="Catatan item"><button class="remove-line">Hapus</button></div></div></div>
<label class="note-field">Catatan pesanan<textarea placeholder="Contoh: tanpa sedotan"></textarea></label>
<div class="cart-summary"><div><span>Subtotal</span><strong>Rp38.000</strong></div><div><span>Pajak</span><strong>Dihitung saat pembayaran</strong></div><div><span>Diskon</span><strong>Rp0</strong></div><div class="total-line"><span>Total sementara</span><strong>Rp38.000</strong></div></div>
<button class="pay-button"><span>Lanjut bayar - 1 item</span><span>→</span></button><p class="cart-footnote">Draft dan stok belum disimpan. Stok dipotong setelah pembayaran berhasil.</p>
</aside></div></main></div>'''

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=1, is_mobile=True, has_touch=True)
    page.set_content(html)
    page.screenshot(path='gcims-pos-mobile-cart-fixed.png', full_page=True)
    result = page.evaluate('''() => {
      const panel = document.querySelector('#cart-panel');
      const selectors = ['.cart-line-controls', '.line-note', '.remove-line', '.cart-summary', '.total-line strong', '.pay-button'];
      const boxes = Object.fromEntries(selectors.map(s => { const r = document.querySelector(s).getBoundingClientRect(); return [s, {left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width)}]; }));
      const p = panel.getBoundingClientRect();
      return {viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, panel: {left: Math.round(p.left), right: Math.round(p.right), width: Math.round(p.width)}, boxes};
    }''')
    print(result)
    browser.close()
