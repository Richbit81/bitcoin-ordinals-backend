# Script zum Neustarten des Backend-Servers
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Backend-Server Neustart-Script" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""

# Schritt 1: Alle Node-Prozesse beenden
Write-Host "[1/4] Stoppe alle Node-Prozesse..." -ForegroundColor Yellow
$nodeProcesses = Get-Process -Name "node" -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    $nodeProcesses | ForEach-Object {
        Write-Host "  -> Beende Prozess: PID $($_.Id)" -ForegroundColor Gray
        Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "  OK $($nodeProcesses.Count) Node-Prozess(e) beendet" -ForegroundColor Green
} else {
    Write-Host "  OK Keine Node-Prozesse gefunden" -ForegroundColor Green
}
Start-Sleep -Seconds 3

# Schritt 2: Cache loeschen
Write-Host ""
Write-Host "[2/4] Loesche Caches..." -ForegroundColor Yellow
$cachePaths = @(".\node_modules\.cache", ".\.cache", ".\dist")
foreach ($cachePath in $cachePaths) {
    if (Test-Path $cachePath) {
        Remove-Item -Path $cachePath -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "  OK Cache geloescht: $cachePath" -ForegroundColor Green
    }
}

# Schritt 3: Pruefe Datei
Write-Host ""
Write-Host "[3/4] Pruefe ordinalTransferService.js..." -ForegroundColor Yellow
$serviceFile = ".\services\ordinalTransferService.js"
if (Test-Path $serviceFile) {
    $content = Get-Content $serviceFile -Raw
    if ($content -match "utxoValueBigInt\s*=\s*BigInt") {
        Write-Host "  OK BigInt Konvertierung gefunden" -ForegroundColor Green
    } else {
        Write-Host "  FEHLER: BigInt Konvertierung NICHT gefunden!" -ForegroundColor Red
    }
    if ($content -match "value:\s*utxoValueBigInt") {
        Write-Host "  OK utxoValueBigInt wird als value verwendet" -ForegroundColor Green
    } else {
        Write-Host "  FEHLER: utxoValueBigInt wird NICHT verwendet!" -ForegroundColor Red
    }
    $fileInfo = Get-Item $serviceFile
    Write-Host "  Datei geaendert: $($fileInfo.LastWriteTime)" -ForegroundColor Gray
}

# Schritt 4: Server starten
Write-Host ""
Write-Host "[4/4] Starte Backend-Server..." -ForegroundColor Yellow
$env:PORT = "3003"
$serverCommand = "cd '$PWD'; `$env:PORT='3003'; Write-Host '====================================' -ForegroundColor Green; Write-Host 'Backend-Server startet...' -ForegroundColor Yellow; Write-Host 'Port: 3003' -ForegroundColor Cyan; Write-Host 'Pre-Signing Workflow (OHNE Private Key)' -ForegroundColor Cyan; Write-Host '====================================' -ForegroundColor Green; npm start"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $serverCommand -WindowStyle Normal
Write-Host "  OK Server gestartet (in neuem Fenster)" -ForegroundColor Green

Write-Host ""
Write-Host "  Warte 15 Sekunden..." -ForegroundColor Gray
Start-Sleep -Seconds 15

# Teste Server
Write-Host ""
Write-Host "Teste Server..." -ForegroundColor Cyan
try {
    $healthResponse = Invoke-WebRequest -Uri "http://localhost:3003/api/health" -Method GET -TimeoutSec 5 -ErrorAction Stop
    if ($healthResponse.StatusCode -eq 200) {
        Write-Host "  OK Server antwortet!" -ForegroundColor Green
        Write-Host ""
        Write-Host "  Teste prepare-psbt Endpoint..." -ForegroundColor Yellow
        $testBody = @{
            inscriptionId = "7a87062f7097d62071a728185bee380839df837b29a76f2923996a96a263fbafi0"
            recipientAddress = "bc1p9j4g6r27yqhmp4c403vn33mz7uug439sthqngkkrylu7d7uq7d6qvz39jj"
            feeRate = 5
        } | ConvertTo-Json
        
        try {
            $testResponse = Invoke-WebRequest -Uri "http://localhost:3003/api/point-shop/admin/prepare-psbt" -Method POST -Body $testBody -ContentType "application/json" -Headers @{"X-Admin-Address" = "bc1p9j4g6r27yqhmp4c403vn33mz7uug439sthqngkkrylu7d7uq7d6qvz39jj"} -TimeoutSec 10 -ErrorAction Stop
            if ($testResponse.StatusCode -eq 200) {
                Write-Host "  OK Endpoint funktioniert!" -ForegroundColor Green
                $testData = $testResponse.Content | ConvertFrom-Json
                Write-Host "  PSBT Base64 Laenge: $($testData.psbtBase64.Length)" -ForegroundColor Gray
            }
        }
        catch {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $errorBody = $reader.ReadToEnd()
            $reader.Close()
            Write-Host "  FEHLER: $($_.Exception.Response.StatusCode)" -ForegroundColor Red
            Write-Host "  Details: $errorBody" -ForegroundColor Yellow
            if ($errorBody -match '"value":(\d+)') {
                Write-Host "  PROBLEM: value ist noch eine Zahl ($($matches[1])), kein BigInt!" -ForegroundColor Red
                Write-Host "  -> Server laedt moeglicherweise noch alte Version" -ForegroundColor Yellow
            }
        }
    }
}
catch {
    Write-Host "  FEHLER: Server nicht erreichbar!" -ForegroundColor Red
    Write-Host "  Fehler: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "======================================" -ForegroundColor Cyan
Write-Host "Fertig!" -ForegroundColor Green
Write-Host "======================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Naechste Schritte:" -ForegroundColor Cyan
Write-Host "  1. Pruefe das Server-Fenster fuer Logs" -ForegroundColor Gray
Write-Host "  2. Wenn Fehler weiterhin besteht, pruefe Server-Logs" -ForegroundColor Gray
Write-Host ""
