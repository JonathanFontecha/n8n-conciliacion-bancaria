// Arma workflow/conciliacion_bancaria.json a partir del código legible de
// workflow/codigo/*.js. Así el JavaScript se revisa como archivo normal y el
// JSON que se importa en n8n nunca queda desactualizado.
//
//   node scripts/armar_workflow.mjs
//
// No necesita n8n ni internet: solo escribe un archivo JSON.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const codigo = (nombre) => readFileSync(join(RAIZ, 'workflow', 'codigo', nombre), 'utf8');

// Identificadores fijos: el JSON sale idéntico cada vez que se arma.
const id = (n) => `5c0a1d2e-0000-4000-8000-${String(n).padStart(12, '0')}`;

const parametro = (n, name, value) => ({ id: id(100 + n), name, value, type: typeof value === 'number' ? 'number' : 'string' });

const nodes = [
  {
    id: id(1), name: 'Inicio manual', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1,
    position: [0, 300], parameters: {},
  },
  {
    id: id(2), name: 'Parámetros', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [220, 300],
    parameters: {
      assignments: {
        assignments: [
          parametro(1, 'carpeta', '.'),
          parametro(2, 'empresa', 'Ejemplo Construcciones LLC'),
          parametro(3, 'cuenta', 'Cuenta corriente terminada en 2207 · Banco Ficticio'),
          parametro(4, 'periodo', 'Octubre 2026'),
          parametro(5, 'fecha_corte', '2026-10-31'),
          parametro(6, 'saldo_inicial_banco', 48250),
          parametro(7, 'saldo_inicial_libros', 48250),
          parametro(8, 'tolerancia_dias', 3),
          parametro(9, 'tolerancia_dias_referencia', 15),
          parametro(10, 'tolerancia_monto_pct', 10),
          parametro(11, 'fechas_con_barras', 'MM/DD/YYYY'),
        ],
      },
      options: {},
    },
  },
  {
    id: id(3), name: 'Leer CSV del banco y de QuickBooks', type: 'n8n-nodes-base.readWriteFile', typeVersion: 1.1,
    position: [440, 300],
    parameters: { fileSelector: "={{ $('Parámetros').first().json.carpeta }}/data/{banco,quickbooks}.csv", options: {} },
  },
  {
    id: id(4), name: 'Extraer filas del CSV', type: 'n8n-nodes-base.extractFromFile', typeVersion: 1.1,
    position: [660, 300],
    parameters: { operation: 'csv', binaryPropertyName: 'data', options: {} },
  },
  {
    id: id(5), name: 'Conciliar', type: 'n8n-nodes-base.code', typeVersion: 2, position: [880, 300],
    parameters: { mode: 'runOnceForAllItems', jsCode: codigo('conciliar.js') },
  },
  {
    id: id(6), name: 'Separar detalle en filas', type: 'n8n-nodes-base.splitOut', typeVersion: 1,
    position: [1100, 180], parameters: { fieldToSplitOut: 'detalle', options: {} },
  },
  {
    id: id(7), name: 'Detalle a CSV', type: 'n8n-nodes-base.convertToFile', typeVersion: 1.1,
    position: [1320, 180], parameters: { operation: 'csv', options: { fileName: 'reporte_conciliacion.csv' } },
  },
  {
    id: id(8), name: 'Guardar reporte CSV', type: 'n8n-nodes-base.readWriteFile', typeVersion: 1.1,
    position: [1540, 180],
    parameters: {
      operation: 'write',
      fileName: "={{ $('Parámetros').first().json.carpeta }}/output/reporte_conciliacion.csv",
      dataPropertyName: 'data', options: {},
    },
  },
  {
    id: id(9), name: 'Armar reporte HTML', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1100, 420],
    parameters: { mode: 'runOnceForAllItems', jsCode: codigo('reporte_html.js') },
  },
  {
    id: id(10), name: 'HTML a archivo', type: 'n8n-nodes-base.convertToFile', typeVersion: 1.1,
    position: [1320, 420],
    parameters: { operation: 'toText', sourceProperty: 'html', options: { fileName: 'reporte_conciliacion.html' } },
  },
  {
    id: id(11), name: 'Guardar reporte HTML', type: 'n8n-nodes-base.readWriteFile', typeVersion: 1.1,
    position: [1540, 420],
    parameters: {
      operation: 'write',
      fileName: "={{ $('Parámetros').first().json.carpeta }}/output/reporte_conciliacion.html",
      dataPropertyName: 'data', options: {},
    },
  },
  {
    id: id(12), name: 'Nota', type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position: [-20, -20],
    parameters: {
      width: 860, height: 260, color: 7,
      content:
        '## Conciliación bancaria automática (demo, datos ficticios)\n' +
        'Compara el extracto del banco (`data/banco.csv`) contra el export de QuickBooks (`data/quickbooks.csv`).\n\n' +
        '1. **Parámetros**: empresa, periodo, saldos iniciales y tolerancias. `carpeta` es la raíz de la demo (`.` = donde se arrancó n8n).\n' +
        '2. **Conciliar**: monto exacto ±3 días → referencia → duplicados → nombre parecido con monto distinto → lo que sobra.\n' +
        '3. Escribe `output/reporte_conciliacion.csv` (detalle) y `output/reporte_conciliacion.html` (resumen + tablas).',
    },
  },
];

const una = (destino) => ({ main: [[{ node: destino, type: 'main', index: 0 }]] });
const connections = {
  'Inicio manual': una('Parámetros'),
  'Parámetros': una('Leer CSV del banco y de QuickBooks'),
  'Leer CSV del banco y de QuickBooks': una('Extraer filas del CSV'),
  'Extraer filas del CSV': una('Conciliar'),
  'Conciliar': {
    main: [[
      { node: 'Separar detalle en filas', type: 'main', index: 0 },
      { node: 'Armar reporte HTML', type: 'main', index: 0 },
    ]],
  },
  'Separar detalle en filas': una('Detalle a CSV'),
  'Detalle a CSV': una('Guardar reporte CSV'),
  'Armar reporte HTML': una('HTML a archivo'),
  'HTML a archivo': una('Guardar reporte HTML'),
};

const workflow = {
  id: 'ConciliacionDemo',
  name: 'Conciliación bancaria automática (demo)',
  active: false,
  nodes,
  connections,
  settings: { executionOrder: 'v1' },
  pinData: {},
  tags: [],
  meta: { templateCredsSetupCompleted: true },
};

const destino = join(RAIZ, 'workflow', 'conciliacion_bancaria.json');
writeFileSync(destino, JSON.stringify(workflow, null, 2) + '\n');
console.log(`Listo: ${destino} (${nodes.length} nodos)`);
