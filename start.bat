@echo off
echo.
echo ╔══════════════════════════════════════════════════════╗
echo ║     🤖 AI Website Cloner - Starting Up               ║
echo ╚══════════════════════════════════════════════════════╝
echo.

REM Configure Ollama for NVIDIA RTX Laptop GPU
set OLLAMA_KEEP_ALIVE=-1
set CUDA_VISIBLE_DEVICES=0
set OLLAMA_NUM_PARALLEL=1

REM Verify Ollama is accessible
curl -s http://127.0.0.1:11434/api/tags >nul 2>&1
if %errorlevel% neq 0 (
    echo [Notice] Starting Ollama daemon in background...
    start "Ollama Server" /min ollama serve
    echo Waiting for Ollama to become ready...
    :wait_ollama
    timeout /t 2 /nobreak >nul
    curl -s http://127.0.0.1:11434/api/tags >nul 2>&1
    if %errorlevel% neq 0 goto wait_ollama
    echo [Ollama] ✅ Ollama is ready!
) else (
    echo [Ollama] ✅ Ollama is already running.
)

echo [1/2] Starting AI Agent Backend on port 3001...
start "AI Cloner - Agent" cmd /k "cd /d %~dp0agent && npm run dev"

timeout /t 3 /nobreak >nul

echo [2/2] Starting UI on port 3000...
start "AI Cloner - UI" cmd /k "cd /d %~dp0ui && npm run dev"

timeout /t 5 /nobreak >nul

echo.
echo ✅ Both services started!
echo.
echo 🌐 UI:    http://localhost:3000
echo 🤖 Agent: http://localhost:3001
echo.
echo Opening browser...
start http://localhost:3000

pause
