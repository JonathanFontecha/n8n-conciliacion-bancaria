// =============================================================================
// Nodo «Armar reporte HTML» — n8n Code node (JavaScript), «Run Once for All Items».
//
// Entrada : el item { resumen, detalle } que sale del nodo «Conciliar».
// Salida  : UN item con el campo `html` (la página completa, sin dependencias
//           externas: se abre sin internet y se imprime bien en PDF).
//
// Copia legible del código que va dentro de workflow/conciliacion_bancaria.json.
// Si lo cambias, vuelve a armar el JSON con:  node scripts/armar_workflow.mjs
// =============================================================================

const { resumen: R, detalle } = $input.first().json;
const S = R.saldos;
const C = R.conteo;

// Todo texto que viene de los CSV se escapa: un memo con «<script>» se muestra
// como texto, no se ejecuta.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

// 1234.5 -> "$1,234.50"; -45 -> "−$45.00"
function dinero(v) {
  if (v === '' || v === null || v === undefined) return '';
  const c = Math.round(Number(v) * 100);
  const abs = Math.abs(c);
  const entero = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${c < 0 ? '−' : ''}$${entero}.${String(abs % 100).padStart(2, '0')}`;
}
const celdaDinero = (v) => `<td class="num${Number(v) < 0 ? ' neg' : ''}">${dinero(v)}</td>`;

const SECCIONES = [
  { cat: 'Diferencia de monto', clase: 'amb', explica: 'El mismo movimiento aparece en los dos lados pero con distinto valor. Casi siempre es un error al digitar en libros.',
    cols: [['fecha_banco', 'Fecha banco'], ['descripcion_banco', 'Banco'], ['monto_banco', 'Monto banco', 1], ['nombre_libros', 'QuickBooks'], ['num_libros', 'Num'], ['monto_libros', 'Monto libros', 1], ['diferencia', 'Diferencia', 1], ['subtipo', 'Posible causa']] },
  { cat: 'Posible duplicado', clase: 'roj', explica: 'Un registro que aparece dos veces en el mismo lado y una sola vez en el otro.',
    cols: [['fecha_libros', 'Fecha libros'], ['tipo_libros', 'Tipo'], ['nombre_libros', 'Nombre'], ['memo_libros', 'Memo'], ['monto_libros', 'Monto libros', 1], ['fecha_banco', 'Fecha banco'], ['descripcion_banco', 'Banco'], ['monto_banco', 'Monto banco', 1], ['accion_sugerida', 'Qué hacer']] },
  { cat: 'Solo en banco', clase: 'azu', explica: 'Salió del banco pero nadie lo registró en QuickBooks: comisiones, intereses, cargos automáticos.',
    cols: [['fecha_banco', 'Fecha'], ['descripcion_banco', 'Descripción'], ['referencia_banco', 'Referencia'], ['monto_banco', 'Monto', 1], ['accion_sugerida', 'Qué hacer']] },
  { cat: 'Solo en libros', clase: 'vio', explica: 'Está registrado en QuickBooks pero todavía no pasó por el banco: cheques sin cobrar y depósitos en camino.',
    cols: [['fecha_libros', 'Fecha'], ['tipo_libros', 'Tipo'], ['num_libros', 'Num'], ['nombre_libros', 'Nombre'], ['memo_libros', 'Memo'], ['monto_libros', 'Monto', 1], ['accion_sugerida', 'Qué hacer']] },
  { cat: 'Conciliado', clase: 'ver', explica: 'Coinciden en monto exacto. La columna «Días» muestra cuántos días tardó el banco en reflejarlo.',
    cols: [['fecha_banco', 'Fecha banco'], ['fecha_libros', 'Fecha libros'], ['dias_desfase', 'Días'], ['descripcion_banco', 'Banco'], ['nombre_libros', 'QuickBooks'], ['monto_banco', 'Monto', 1], ['metodo', 'Cómo se empató']] },
];

function tabla(sec) {
  const filas = detalle.filter((r) => r.categoria === sec.cat);
  if (!filas.length) return `<p class="vacio">Sin movimientos en esta categoría.</p>`;
  const cab = sec.cols.map(([, t, n]) => `<th${n ? ' class="num"' : ''}>${esc(t)}</th>`).join('');
  const cuerpo = filas.map((r) => '<tr>' + sec.cols.map(([k, , n]) => (n ? celdaDinero(r[k]) : `<td>${esc(r[k])}</td>`)).join('') + '</tr>').join('');
  return `<div class="tabla"><table><thead><tr>${cab}</tr></thead><tbody>${cuerpo}</tbody></table></div>`;
}

const tarjetas = [
  ['ver', 'Conciliados', C.conciliado, `${C.conciliado_fecha_corrida} con fecha corrida · ${C.conciliado_por_referencia} por referencia`],
  ['amb', 'Diferencias de monto', C.diferencia_de_monto, `ajuste neto ${dinero(S.correcciones_de_monto)}`],
  ['azu', 'Solo en banco', C.solo_en_banco, `cargos ${dinero(S.cargos_no_registrados)} · abonos ${dinero(S.abonos_no_registrados)}`],
  ['vio', 'Solo en libros', C.solo_en_libros, `cheques ${dinero(S.cheques_en_transito)} · depósitos ${dinero(S.depositos_en_transito)}`],
  ['roj', 'Posibles duplicados', C.posible_duplicado, `reverso ${dinero(S.reverso_duplicados_libros + S.reverso_duplicados_banco)}`],
].map(([cl, t, n, sub]) => `<div class="kpi ${cl}"><div class="kpi-n">${n}</div><div class="kpi-t">${esc(t)}</div><div class="kpi-s">${esc(sub)}</div></div>`).join('');

const linea = (txt, v, cl = '') => `<tr class="${cl}"><td>${esc(txt)}</td>${celdaDinero(v)}</tr>`;
const fechaCorte = R.fecha_corte || '';

const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conciliación bancaria · ${esc(R.periodo)}</title>
<style>
  :root { --tinta:#1d2433; --suave:#5b6577; --linea:#e3e7ee; --fondo:#f6f7fb; --ver:#1f8a5b; --amb:#b7791f; --azu:#2b6cb0; --vio:#6b46c1; --roj:#c53030; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--fondo); color:var(--tinta); font:15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { max-width:1120px; margin:0 auto; padding:32px 16px 48px; }
  header h1 { margin:0 0 4px; font-size:26px; }
  header p { margin:0; color:var(--suave); }
  .estado { margin:20px 0; padding:14px 18px; border-radius:10px; font-weight:600; }
  .estado.ok { background:#e6f4ec; color:var(--ver); border:1px solid #b9e0c9; }
  .estado.mal { background:#fdecec; color:var(--roj); border:1px solid #f5c2c2; }
  .kpis { display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:12px; margin:16px 0 28px; }
  .kpi { background:#fff; border:1px solid var(--linea); border-top:4px solid; border-radius:10px; padding:14px 16px; }
  .kpi-n { font-size:30px; font-weight:700; line-height:1.1; }
  .kpi-t { font-weight:600; }
  .kpi-s { color:var(--suave); font-size:13px; }
  .ver { border-top-color:var(--ver); } .amb { border-top-color:var(--amb); } .azu { border-top-color:var(--azu); } .vio { border-top-color:var(--vio); } .roj { border-top-color:var(--roj); }
  h2 { font-size:19px; margin:32px 0 6px; }
  h2 .chip { display:inline-block; min-width:28px; padding:0 8px; margin-left:6px; border-radius:99px; color:#fff; font-size:13px; text-align:center; vertical-align:middle; }
  .chip.ver { background:var(--ver); } .chip.amb { background:var(--amb); } .chip.azu { background:var(--azu); } .chip.vio { background:var(--vio); } .chip.roj { background:var(--roj); }
  .explica { margin:0 0 10px; color:var(--suave); }
  .saldos { display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:16px; }
  .caja { background:#fff; border:1px solid var(--linea); border-radius:10px; padding:6px 16px 10px; }
  .caja h3 { font-size:15px; margin:10px 0 4px; }
  .tabla { overflow-x:auto; background:#fff; border:1px solid var(--linea); border-radius:10px; }
  table { width:100%; border-collapse:collapse; }
  th, td { padding:8px 10px; text-align:left; border-bottom:1px solid var(--linea); vertical-align:top; }
  th { font-size:12px; text-transform:uppercase; letter-spacing:.03em; color:var(--suave); background:#fafbfd; white-space:nowrap; }
  tbody tr:last-child td { border-bottom:0; }
  td.num, th.num { text-align:right; white-space:nowrap; font-variant-numeric:tabular-nums; }
  td.neg { color:#a12b2b; }
  .caja table td { border-bottom:1px dashed var(--linea); }
  .caja tr.total td { font-weight:700; border-top:2px solid var(--tinta); border-bottom:0; }
  .vacio { color:var(--suave); font-style:italic; }
  footer { margin-top:36px; color:var(--suave); font-size:13px; }
  @media print { body { background:#fff; } .kpi, .caja, .tabla { break-inside:avoid; } }
</style>
</head>
<body>
<main>
  <header>
    <h1>Conciliación bancaria · ${esc(R.periodo)}</h1>
    <p>${esc(R.empresa)} · ${esc(R.cuenta)} · corte al ${esc(fechaCorte)}</p>
    <p>${R.movimientos_banco} movimientos del banco contra ${R.movimientos_libros} de QuickBooks${R.filas_ignoradas ? ` · ${R.filas_ignoradas} filas ignoradas (títulos o totales)` : ''}</p>
  </header>

  <div class="estado ${R.cuadra ? 'ok' : 'mal'}">
    ${R.cuadra
      ? `✔ La conciliación cuadra: saldo conciliado ${dinero(S.saldo_conciliado)} y diferencia sin explicar ${dinero(S.diferencia_sin_explicar)}.`
      : `✖ Quedan ${dinero(S.diferencia_sin_explicar)} sin explicar: hay movimientos que el flujo no pudo clasificar.`}
  </div>

  <section class="kpis">${tarjetas}</section>

  <h2>Conciliación de saldos</h2>
  <p class="explica">Los dos lados parten de su propio saldo y, con las partidas encontradas, deben llegar al mismo número.</p>
  <div class="saldos">
    <div class="caja"><h3>Lado del banco</h3><table>
      ${linea(`Saldo según extracto al ${fechaCorte}`, S.saldo_final_banco)}
      ${linea('(+) Depósitos en tránsito', S.depositos_en_transito)}
      ${linea('(−) Cheques en tránsito', S.cheques_en_transito)}
      ${S.reverso_duplicados_banco ? linea('(+) Cobros duplicados del banco a reclamar', S.reverso_duplicados_banco) : ''}
      ${linea('Saldo bancario ajustado', S.saldo_banco_ajustado, 'total')}
    </table></div>
    <div class="caja"><h3>Lado de los libros (QuickBooks)</h3><table>
      ${linea(`Saldo según libros al ${fechaCorte}`, S.saldo_final_libros)}
      ${linea('(+) Abonos del banco sin registrar (intereses)', S.abonos_no_registrados)}
      ${linea('(−) Cargos del banco sin registrar (comisiones)', S.cargos_no_registrados)}
      ${linea('(±) Correcciones por diferencia de monto', S.correcciones_de_monto)}
      ${linea('(+) Reverso de registros duplicados', S.reverso_duplicados_libros)}
      ${linea('Saldo en libros ajustado', S.saldo_libros_ajustado, 'total')}
    </table></div>
  </div>

  ${SECCIONES.map((sec) => `
  <h2>${esc(sec.cat)}<span class="chip ${sec.clase}">${detalle.filter((r) => r.categoria === sec.cat).length}</span></h2>
  <p class="explica">${esc(sec.explica)}</p>
  ${tabla(sec)}`).join('')}

  <footer>
    Reporte generado automáticamente por un flujo de n8n (ejecución ${esc(R.ejecucion_n8n)}) el ${esc(R.generado.replace('T', ' ').slice(0, 19))} UTC.
    Datos ficticios de demostración. Saldo inicial del banco ${dinero(S.saldo_inicial_banco)}; saldo inicial en libros ${dinero(S.saldo_inicial_libros)}.
  </footer>
</main>
</body>
</html>
`;

return [{ json: { html } }];
