[CmdletBinding()]
param(
    [string]$BaseUrl = 'http://127.0.0.1:3000'
)

$ErrorActionPreference = 'Stop'
$username = 'admin'

Write-Host 'GCIMS login + catalog smoke test' -ForegroundColor Cyan
$securePassword = Read-Host 'Masukkan password administrator GCIMS' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$plainPassword = $null

try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    $loginBody = @{
        username = $username
        password = $plainPassword
    } | ConvertTo-Json -Depth 5

    $login = Invoke-RestMethod -Method Post `
        -Uri "$BaseUrl/api/v1/auth/login" `
        -ContentType 'application/json' `
        -Body $loginBody
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    $plainPassword = $null
    $loginBody = $null
    Remove-Variable securePassword -ErrorAction SilentlyContinue
}

if (-not $login.access_token) {
    throw 'Login tidak mengembalikan access_token.'
}

$outletId = $login.scope.outlet_id
$headers = @{ Authorization = "Bearer $($login.access_token)" }
$catalog = Invoke-RestMethod -Method Get `
    -Uri "$BaseUrl/api/v1/outlets/$outletId/catalog" `
    -Headers $headers

Write-Host "`nLOGIN: PASS" -ForegroundColor Green
Write-Host "User: $($login.user.full_name) <$($login.user.email)>"
Write-Host "Outlet: $outletId"
Write-Host "`nCATALOG: $($catalog.data.Count) menu ditemukan" -ForegroundColor Green

foreach ($menu in $catalog.data) {
    Write-Host "- $($menu.menu_name)"
    foreach ($variant in $menu.variants) {
        $recipe = if ($variant.active_recipe_version_id) { 'resep aktif tersedia' } else { 'resep aktif belum ada' }
        Write-Host ("  {0} | Rp{1:N0} | {2}" -f $variant.name, $variant.price_amount, $recipe)
    }
}

if (-not ($catalog.data | Where-Object { $_.menu_name -eq 'Caramel Macchiato' })) {
    throw 'Caramel Macchiato tidak ditemukan di katalog.'
}
Write-Host "`nSMOKE TEST LOGIN + CATALOG: PASS" -ForegroundColor Green
