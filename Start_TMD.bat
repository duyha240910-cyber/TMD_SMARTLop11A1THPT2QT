@echo off
cd /d "%~dp0"
start "TMD Server" cmd /k "npm start"
start "Cloudflare Tunnel" cmd /k "npx cloudflared tunnel --url http://localhost:3000"