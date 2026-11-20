$ErrorActionPreference = 'Stop'

$BaseUrl = 'http://127.0.0.1:3000'
$Username = 'admin'

Write-Host 'GCIMS draft-order smoke test' -ForegroundColor Cyan
Write-Host 'Target: db_gcims_test | Caramel Macchiato Regular x 1'

$securePassword = Read-Host 'Masukkan password administrator GCIMS' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$plainPassword = $null

try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)

    # 1. Login admin
    $loginBody = @{
        username = $Username
        password = $plainPassword
    } | ConvertTo-Json -Compress

    $login = Invoke-RestMethod -Method Post `
        -Uri "$BaseUrl/api/v1/auth/login" `
        -ContentType 'application/json' `
        -Body $loginBody

    if ([string]::IsNullOrWhiteSpace($login.access_token)) {
        throw 'Login tidak mengembalikan access_token.'
    }
    Write-Host 'LOGIN: PASS' -ForegroundColor Green
    Write-Host "User: $($login.user.full_name) <$($login.user.email)>"

    $headers = @{ Authorization = "Bearer $($login.access_token)" }
    $OutletId = $login.scope.outlet_id
    $locations = Invoke-RestMethod -Method Get `
        -Uri "$BaseUrl/api/v1/outlets/$OutletId/stock-locations" -Headers $headers
    $stockLocation = $locations.data | Select-Object -First 1
    $StockLocationId = $stockLocation.id
    if ([string]::IsNullOrWhiteSpace($StockLocationId)) { throw 'Outlet belum memiliki lokasi stok aktif.' }

    # 2. Resolve variant from live catalog (avoid hardcoding variant UUID)
    $catalog = Invoke-RestMethod -Method Get `
        -Uri "$BaseUrl/api/v1/outlets/$OutletId/catalog?q=Caramel%20Macchiato&limit=25" `
        -Headers $headers

    $menu = @($catalog.data | Where-Object { $_.menu_name -eq 'Caramel Macchiato' } | Select-Object -First 1)
    if ($menu.Count -eq 0) { throw 'Caramel Macchiato tidak ditemukan pada katalog outlet.' }

    $variant = @($menu[0].variants | Where-Object {
        $_.name -eq 'Regular' -and $_.is_available -eq $true -and $_.active_recipe_version_id
    } | Select-Object -First 1)
    if ($variant.Count -eq 0) { throw 'Varian Regular tidak tersedia atau tidak memiliki resep aktif.' }

    Write-Host 'CATALOG: PASS' -ForegroundColor Green
    Write-Host "Menu: $($menu[0].menu_name) | Variant: $($variant[0].name) | Price: Rp$('{0:N0}' -f [int]$variant[0].price_amount)"
    Write-Host 'Active recipe version: ditemukan'

    # 3. Create a single draft order. Unique key makes this run safely repeatable.
    $idempotencyKey = 'draft-gcims-' + [guid]::NewGuid().ToString('N')
    $orderBody = @{
        order_type = 'takeaway'
        stock_location_id = $StockLocationId
        queue_name = 'TEST-GCIMS'
        customer_note = 'Smoke test draft order; tidak untuk produksi.'
        lines = @(
            @{
                menu_variant_id = $variant[0].menu_variant_id
                quantity = '1'
                item_note = 'Uji snapshot BOM'
            }
        )
    } | ConvertTo-Json -Depth 8 -Compress

    $order = Invoke-RestMethod -Method Post `
        -Uri "$BaseUrl/api/v1/outlets/$OutletId/orders" `
        -Headers (@{
            Authorization = "Bearer $($login.access_token)"
            'Idempotency-Key' = $idempotencyKey
        }) `
        -ContentType 'application/json' `
        -Body $orderBody

    # 4. Read back order and assert draft / totals / item count.
    $savedOrder = Invoke-RestMethod -Method Get `
        -Uri "$BaseUrl/api/v1/orders/$($order.id)" `
        -Headers $headers

    if ($savedOrder.status -ne 'draft') { throw "Status order tidak sesuai: $($savedOrder.status)" }
    if (@($savedOrder.lines).Count -ne 1) { throw 'Jumlah baris order tidak sesuai; seharusnya 1.' }
    if ([int]$savedOrder.lines[0].unit_price_amount -ne 38000) { throw 'Harga snapshot bukan Rp38.000.' }

    Write-Host 'CREATE DRAFT: PASS' -ForegroundColor Green
    Write-Host "Order number: $($savedOrder.order_number)"
    Write-Host "Order ID: $($savedOrder.id)"
    Write-Host "Status: $($savedOrder.status)"
    Write-Host "Version: $($savedOrder.version_no)"
    Write-Host "Subtotal: Rp$('{0:N0}' -f [int]$savedOrder.gross_subtotal_amount)"
    Write-Host "Tax: Rp$('{0:N0}' -f [int]$savedOrder.tax_amount) (mengikuti konfigurasi database)"
    Write-Host "Grand total: Rp$('{0:N0}' -f [int]$savedOrder.grand_total_amount)"
    Write-Host "Draft order smoke test: PASS" -ForegroundColor Green
    Write-Host ''
    Write-Host 'PENTING: Ini hanya draft. Belum ada pembayaran, tiket barista, reservasi, atau pemotongan stok.' -ForegroundColor Yellow
    Write-Host "IDEMPOTENCY_KEY=$idempotencyKey"
    Write-Host "ORDER_ID=$($savedOrder.id)"
}
finally {
    if ($ptr -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
    $plainPassword = $null
    Remove-Variable loginBody, login, headers, catalog, menu, variant, orderBody, order, savedOrder -ErrorAction SilentlyContinue
}
