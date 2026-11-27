import asyncio
from pathlib import Path

from playwright.async_api import async_playwright


async def main():
    root = Path(__file__).parent
    html = (root / "public/admin.html").read_text(encoding="utf-8")
    css = (root / "public/admin.css").read_text(encoding="utf-8")
    js = (root / "public/admin.js").read_text(encoding="utf-8")
    html = html.replace('<link rel="stylesheet" href="/admin.css">', f"<style>{css}</style>")
    html = html.replace('<script src="/admin.js" defer></script>', "")
    html = html.replace('src="/pos-assets/gourmets-logo.png"', f'src="file:///{root.as_posix()}/public/pos-assets/gourmets-logo.png"')
    api_mock = """<script>
    window.fetch = async (input) => {
      const url=String(input);
      let body={data:[]};
      if(url.endsWith('/auth/me')) body={csrf_token:'visual-check',permissions:['admin.dashboard.read','admin.menu.update'],user:{full_name:'Rani Admin'}};
      if(url.endsWith('/admin/dashboard')) body={outlet_name:"Gourmet's Coffee · Kemang",active_stock_locations:4,gross_sales_amount:4285000,completed_transactions:87,low_stock_items:2,low_stock_list:[{name:'Susu full cream',sku:'DRK-014',on_hand_qty_base:3.5,minimum_stock_base:8,base_uom_code:'L'},{name:'Biji kopi house blend',sku:'COF-001',on_hand_qty_base:1.2,minimum_stock_base:3,base_uom_code:'kg'}]};
      return {ok:true,status:200,json:async()=>body};
    };
    </script>"""
    html = html.replace("</body>", f"{api_mock}<script>{js}</script></body>")
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True,
            executable_path=r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            args=["--no-sandbox"],
        )
        page = await browser.new_page(viewport={"width": 1440, "height": 1000})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        await page.set_content(html, wait_until="load")
        await page.screenshot(path="D:/Coding/Py/gcims-admin-desktop.png", full_page=True)
        desktop = {
            "heading": await page.locator("#dashboard-page h1").inner_text(),
            "metric_cards": await page.locator(".metric-card:not(.skeleton)").count(),
            "current_nav": await page.locator(".admin-nav [aria-current=page]").inner_text(),
            "horizontal_overflow": await page.evaluate("document.documentElement.scrollWidth > innerWidth"),
        }
        await page.set_viewport_size({"width": 390, "height": 844})
        await page.screenshot(path="D:/Coding/Py/gcims-admin-mobile.png", full_page=True)
        mobile = {
            "horizontal_overflow": await page.evaluate("document.documentElement.scrollWidth > innerWidth"),
            "active_nav_visible": await page.locator(".admin-nav [aria-current=page]").is_visible(),
            "nav_sizes": await page.locator(".admin-nav").evaluate("e => [e.clientWidth, e.scrollWidth]"),
        }
        print({"desktop": desktop, "mobile": mobile, "page_errors": errors})
        await browser.close()


asyncio.run(main())
