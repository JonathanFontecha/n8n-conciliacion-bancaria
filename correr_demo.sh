#!/usr/bin/env bash
# =============================================================================
# Corre la demo de punta a punta SIN abrir el editor web de n8n:
#   1. arma workflow/conciliacion_bancaria.json desde workflow/codigo/*.js
#   2. lo importa en el n8n LOCAL de esta carpeta (node_modules/.bin/n8n)
#   3. lo ejecuta por línea de comandos
#   4. confirma que salieron los dos reportes y que no quedó n8n vivo
#
# Uso:   ./correr_demo.sh
# =============================================================================
set -euo pipefail

DEMO="$(cd "$(dirname "$0")" && pwd -P)"
cd "$DEMO"
N8N="$DEMO/node_modules/.bin/n8n"

INSTALAR="npm ci --ignore-scripts && npm rebuild sqlite3"
if [[ ! -x "$N8N" ]]; then
  echo "Falta n8n local. Instálalo con:  $INSTALAR" >&2
  exit 1
fi
if [[ ! -f "$DEMO/node_modules/sqlite3/build/Release/node_sqlite3.node" ]]; then
  echo "Falta el binario de sqlite3 (la base de n8n). Corre:  npm rebuild sqlite3" >&2
  exit 1
fi

# --- n8n aislado en esta carpeta ---------------------------------------------
# N8N_USER_FOLDER: n8n crea su base SQLite y su configuración en $DEMO/.n8n
export N8N_USER_FOLDER="$DEMO"
# Los nodos de disco solo pueden tocar estas dos carpetas (separadas por «;»)
export N8N_RESTRICT_FILE_ACCESS_TO="$DEMO/data;$DEMO/output"
# Nada sale a internet: sin telemetría, sin avisos de versión, sin plantillas
export N8N_DIAGNOSTICS_ENABLED=false
export N8N_VERSION_NOTIFICATIONS_ENABLED=false
export N8N_TEMPLATES_ENABLED=false
export N8N_PERSONALIZATION_ENABLED=false
export N8N_HIRING_BANNER_ENABLED=false
export N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true
# «info» es obligatorio: n8n imprime el resultado de «execute» en ese nivel
export N8N_LOG_LEVEL=info

mkdir -p "$DEMO/output"
rm -f "$DEMO/output/reporte_conciliacion.csv" "$DEMO/output/reporte_conciliacion.html" "$DEMO/output/ultima_ejecucion.log"

echo "▸ Node $(node -v) · n8n $("$N8N" --version)"

echo "▸ 1/3 Armando el flujo desde workflow/codigo/"
node "$DEMO/scripts/armar_workflow.mjs"

echo "▸ 2/3 Importando el flujo"
"$N8N" import:workflow --input="$DEMO/workflow/conciliacion_bancaria.json" | grep -vE "migration|license SDK" || true

echo "▸ 3/3 Ejecutando el flujo (id ConciliacionDemo)"
#     El aviso «Failed to start Python task runner» es normal: este flujo solo usa JavaScript.
LOG="$DEMO/output/ultima_ejecucion.log"
if ! "$N8N" execute --id=ConciliacionDemo --rawOutput > "$LOG" 2>&1; then
  echo "✖ La ejecución falló. Detalle en output/ultima_ejecucion.log" >&2
  tail -20 "$LOG" >&2
  exit 1
fi

for f in reporte_conciliacion.csv reporte_conciliacion.html; do
  if [[ ! -s "$DEMO/output/$f" ]]; then
    echo "✖ No se generó output/$f — revisa output/ultima_ejecucion.log" >&2
    exit 1
  fi
done

# Resumen leído de los datos de la ejecución que acaba de terminar
node -e '
const raw = require("fs").readFileSync(process.argv[1], "utf8");
const e = JSON.parse(raw.slice(raw.search(/^\{/m)));
const run = e.data.resultData.runData;
const r = run["Conciliar"][0].data.main[0][0].json.resumen;
const c = r.conteo, s = r.saldos;
console.log(`  ejecución n8n #${r.ejecucion_n8n} · estado: ${e.status} · ${Object.keys(run).length} nodos`);
console.log(`  conciliados ${c.conciliado} · diferencias de monto ${c.diferencia_de_monto} · solo en banco ${c.solo_en_banco} · solo en libros ${c.solo_en_libros} · posibles duplicados ${c.posible_duplicado}`);
console.log(`  saldo conciliado ${s.saldo_conciliado.toFixed(2)} · diferencia sin explicar ${s.diferencia_sin_explicar.toFixed(2)}`);
' "$LOG"

if pgrep -f "$DEMO/node_modules" > /dev/null; then
  echo "⚠ Quedó un proceso de n8n vivo:" >&2
  pgrep -fl "$DEMO/node_modules" >&2
  exit 1
fi

echo "✔ Listo. Reportes en output/:"
ls -l "$DEMO/output"
