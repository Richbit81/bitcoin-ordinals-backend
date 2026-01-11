# Test-Skript für Bitcoin RPC-Verbindung
# Testet alle neuen Bitcoin-RPC Endpunkte

Write-Host "🔍 Teste Bitcoin RPC-Verbindung..." -ForegroundColor Cyan
Write-Host ""

$baseUrl = "http://localhost:3002"

# Test 1: Bitcoin Status
Write-Host "1. Teste /api/bitcoin/status..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$baseUrl/api/bitcoin/status" -UseBasicParsing
    $result = $response.Content | ConvertFrom-Json
    if ($result.success) {
        Write-Host "   ✅ Bitcoin Core verbunden!" -ForegroundColor Green
        Write-Host "   Chain: $($result.chain)" -ForegroundColor Cyan
        Write-Host "   Blocks: $($result.blocks)" -ForegroundColor Cyan
        Write-Host "   Progress: $($result.progressPercent)%" -ForegroundColor Cyan
        Write-Host "   Synced: $($result.synced)" -ForegroundColor $(if ($result.synced) { "Green" } else { "Yellow" })
    } else {
        Write-Host "   ❌ Nicht verbunden: $($result.error)" -ForegroundColor Red
    }
} catch {
    Write-Host "   ❌ Fehler: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Test 2: Blockchain Info
Write-Host "2. Teste /api/bitcoin/blockchain-info..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$baseUrl/api/bitcoin/blockchain-info" -UseBasicParsing
    $result = $response.Content | ConvertFrom-Json
    if ($result.success) {
        Write-Host "   ✅ Blockchain-Info erhalten!" -ForegroundColor Green
        Write-Host "   Best Block: $($result.info.bestblockhash.Substring(0, 16))..." -ForegroundColor Cyan
        Write-Host "   Synced: $($result.info.synced)" -ForegroundColor $(if ($result.info.synced) { "Green" } else { "Yellow" })
    } else {
        Write-Host "   ❌ Fehler: $($result.error)" -ForegroundColor Red
    }
} catch {
    Write-Host "   ❌ Fehler: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Test 3: Wallet Balance
Write-Host "3. Teste /api/bitcoin/wallet-balance..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "$baseUrl/api/bitcoin/wallet-balance" -UseBasicParsing
    $result = $response.Content | ConvertFrom-Json
    if ($result.success) {
        Write-Host "   ✅ Wallet-Balance: $($result.balance) BTC" -ForegroundColor Green
        if ($result.error) {
            Write-Host "   ⚠️  Hinweis: $($result.error)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "   ❌ Fehler: $($result.error)" -ForegroundColor Red
    }
} catch {
    Write-Host "   ❌ Fehler: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "Tests abgeschlossen!" -ForegroundColor Green
Write-Host ""
Write-Host "Hinweis: Falls Endpunkte nicht gefunden werden (404)," -ForegroundColor Yellow
Write-Host "   muss der Server neu gestartet werden:" -ForegroundColor Yellow
Write-Host "   cd C:\Users\thoma\bitcoin-ordinals-backend" -ForegroundColor White
Write-Host "   node server.js" -ForegroundColor White

