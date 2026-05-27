# Norte — Iniciar servidor
# Clique com botão direito > "Executar com PowerShell"

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

$host.UI.RawUI.WindowTitle = "Norte Financas"
Write-Host ""
Write-Host "  ╔════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║   🧭  NORTE FINANCAS           ║" -ForegroundColor Cyan
Write-Host "  ╚════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# Verifica Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  ❌ Node.js nao encontrado!" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Instale em: https://nodejs.org" -ForegroundColor Yellow
    Write-Host "  Baixe a versao LTS e instale normalmente." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Pressione qualquer tecla para abrir o site..." -ForegroundColor Gray
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    Start-Process "https://nodejs.org"
    exit
}

$nodeVersion = (node -v)
Write-Host "  ✅ Node.js $nodeVersion encontrado" -ForegroundColor Green

# Instala dependencias se necessario
if (-not (Test-Path "node_modules")) {
    Write-Host ""
    Write-Host "  📦 Instalando dependencias (primeira vez, aguarde)..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "  ❌ Erro ao instalar dependencias." -ForegroundColor Red
        Write-Host "  Tente rodar como Administrador." -ForegroundColor Yellow
        Read-Host "  Pressione Enter para sair"
        exit 1
    }
    Write-Host "  ✅ Dependencias instaladas!" -ForegroundColor Green
}

# Cria pasta data se nao existir
if (-not (Test-Path "data")) {
    New-Item -ItemType Directory -Path "data" | Out-Null
}

Write-Host ""
Write-Host "  🚀 Iniciando o Norte..." -ForegroundColor Cyan
Write-Host ""
Write-Host "  Acesse no navegador: http://localhost:3000" -ForegroundColor Green
Write-Host ""
Write-Host "  Para parar: feche esta janela" -ForegroundColor Gray
Write-Host ""

# Abre o navegador apos 2 segundos
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 3
    Start-Process "http://localhost:3000"
} | Out-Null

# Inicia o servidor
node server.js
