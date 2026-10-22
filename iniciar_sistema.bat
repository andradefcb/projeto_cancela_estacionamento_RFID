@echo off
title SmartPark RFID - Sistema de Estacionamento PEX 2 Período
color 0B

echo ===================================================================
echo     SMARTPARK RFID - SISTEMA DE ESTACIONAMENTO INTELIGENTE
echo               Projeto PEX 2.o Periodo (Arduino)
echo ===================================================================
echo.
echo Iniciando o servidor Node.js...
echo.

:: Abre o navegador padrao apos 2 segundos
start "" timeout /t 2 /nobreak >nul & start http://localhost:3000

:: Inicia o servidor
node server.js

pause

