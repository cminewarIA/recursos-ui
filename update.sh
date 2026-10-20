#!/usr/bin/env bash
set -e

echo "=== Actualizando Dashboard desde GitHub ==="
git pull origin main

echo "=== Reiniciando servicio system-dashboard ==="
sudo systemctl restart system-dashboard.service

echo "=== Estado del servicio ==="
systemctl status system-dashboard.service --no-pager -l
