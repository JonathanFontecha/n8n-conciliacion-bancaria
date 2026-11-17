// =============================================================================
// Nodo «Conciliar» — n8n Code node (JavaScript), modo «Run Once for All Items».
//
// Entrada : las filas de data/banco.csv y data/quickbooks.csv, ya convertidas en
//           items por el nodo «Extract From File». Cada fila se reconoce por sus
//           columnas: el banco trae `fecha/monto`; QuickBooks trae `Date/Amount`.
// Salida  : UN solo item { resumen, detalle } que usan los nodos siguientes.
//
// Todo el dinero se maneja en CENTAVOS ENTEROS (8400.00 -> 840000) para que
// 0.1 + 0.2 nunca dé 0.30000000000000004 en un reporte contable.
//
// Este archivo es la copia legible del código que va dentro del flujo
// (workflow/conciliacion_bancaria.json). Si lo cambias, vuelve a armar el JSON
// con:  node scripts/armar_workflow.mjs
// =============================================================================

const P = $('Parámetros').first().json;
const TOL_DIAS = Number(P.tolerancia_dias ?? 3);                 // ventana del paso 1
const TOL_DIAS_REF = Number(P.tolerancia_dias_referencia ?? 15); // cheques que tardan en cobrarse
const TOL_MONTO_PCT = Number(P.tolerancia_monto_pct ?? 10);      // paso 4: monto parecido
const MIN_SIMILITUD = 0.5;                                       // paso 4: nombre parecido
const FECHAS_CON_BARRAS = String(P.fechas_con_barras || 'MM/DD/YYYY');

// ---------- 1. Utilidades ----------------------------------------------------
const quitarTildes = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const normalizar = (s) =>
  quitarTildes(s).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const compacto = (s) => normalizar(s).replace(/ /g, '');

// "1,234.56" | "-1234.56" | "$1,234.56" | "(1,234.56)" -> centavos enteros, o null
function aCentavos(valor) {
  let s = String(valor ?? '').trim();
  if (!s) return null;
  let negativo = false;
  if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1); }
  s = s.replace(/[−–]/g, '-').replace(/[$\s,]/g, '');
  if (s.startsWith('-')) { negativo = !negativo; s = s.slice(1); }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const c = Math.round(parseFloat(s) * 100);
  return negativo ? -c : c;
}

// "2026-10-08" | "10/08/2026" -> número de día (días desde 1970), o null
function aDia(valor) {
  const s = String(valor ?? '').trim();
  let y, m, d, r;
  if ((r = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) {
    [y, m, d] = [r[1], r[2], r[3]];
  } else if ((r = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) {
    if (FECHAS_CON_BARRAS === 'DD/MM/YYYY') { d = r[1]; m = r[2]; } else { m = r[1]; d = r[2]; }
    y = r[3].length === 2 ? '20' + r[3] : r[3];
  } else {
    return null;
  }
  const t = Date.UTC(+y, +m - 1, +d);
  const f = new Date(t);
  if (f.getUTCMonth() !== +m - 1 || f.getUTCDate() !== +d) return null; // 31/02 no existe
  return Math.round(t / 86400000);
}
const isoDe = (dia) => (dia === null || dia === undefined ? '' : new Date(dia * 86400000).toISOString().slice(0, 10));
const dinero = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2));
const aNumero = (c) => Math.round(c) / 100;

// ---------- 2. Leer y separar las filas --------------------------------------
const banco = [];
const libros = [];
const ignoradas = [];

for (const item of $input.all()) {
  const fila = {};
  for (const [k, v] of Object.entries(item.json)) {
    fila[quitarTildes(k).trim().toLowerCase()] = typeof v === 'string' ? v.trim() : v;
  }
  if ('fecha' in fila || 'monto' in fila) {
    const dia = aDia(fila.fecha);
    const centavos = aCentavos(fila.monto);
    if (dia === null || centavos === null) { ignoradas.push({ origen: 'banco', fila }); continue; }
    banco.push({
      origen: 'banco', idx: banco.length, dia, centavos,
      descripcion: String(fila.descripcion ?? ''), referencia: String(fila.referencia ?? ''),
    });
  } else if ('date' in fila || 'amount' in fila) {
    // Un export real de QuickBooks trae títulos arriba y filas «Total» abajo:
    // cualquier fila sin fecha o sin monto válidos se ignora y se cuenta.
    const dia = aDia(fila.date);
    const centavos = aCentavos(fila.amount);
    if (dia === null || centavos === null) { ignoradas.push({ origen: 'libros', fila }); continue; }
    libros.push({
      origen: 'libros', idx: libros.length, dia, centavos,
      tipo: String(fila['transaction type'] ?? ''), num: String(fila.num ?? ''),
      // Según el reporte, QuickBooks llama a la nota «Memo» o «Memo/Description».
      nombre: String(fila.name ?? ''), memo: String(fila.memo ?? fila['memo/description'] ?? fila.description ?? ''),
    });
  } else {
    ignoradas.push({ origen: 'desconocido', fila });
  }
}

if (!banco.length || !libros.length) {
  throw new Error(
    `No hay datos para conciliar: ${banco.length} movimientos del banco y ${libros.length} de QuickBooks. ` +
    'Revisa que banco.csv tenga las columnas fecha,descripcion,referencia,monto y que ' +
    'quickbooks.csv tenga Date,Transaction Type,Num,Name,Memo,Amount.'
  );
}

// ---------- 3. Criterios para comparar un movimiento del banco con uno de libros
const VACIAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'EL', 'SA', 'LLC', 'INC', 'DEMO', 'CIA', 'THE', 'AND']);
const palabras = (s) => normalizar(s).split(' ').filter((w) => w.length >= 3 && !VACIAS.has(w));

// Qué fracción del «Name» de QuickBooks aparece en el texto del banco (0 a 1).
function similitudNombre(b, l) {
  const nombre = palabras(l.nombre);
  if (!nombre.length) return 0;
  const texto = new Set(palabras(`${b.descripcion} ${b.referencia}`));
  return nombre.filter((w) => texto.has(w)).length / nombre.length;
}

// ¿El «Num» de QuickBooks (número de cheque, etc.) es la referencia del banco?
function mismaReferencia(b, l) {
  const num = compacto(l.num);
  if (!num) return false;
  if (compacto(b.referencia) === num) return true;
  return /^\d{3,}$/.test(num) && normalizar(b.descripcion).split(' ').includes(num);
}

const dias = (b, l) => Math.abs(b.dia - l.dia);
const mismoSigno = (b, l) => Math.sign(b.centavos) === Math.sign(l.centavos);

// ---------- 4. Emparejar ------------------------------------------------------
const usadoB = new Set();
const usadoL = new Set();
const parejas = []; // { b, l, categoria, metodo }

// Recorre los candidatos del mejor al peor y toma cada uno si los dos lados
// siguen libres. Así una misma fila nunca se usa dos veces.
function tomar(candidatos, comparar, categoria, metodo) {
  candidatos.sort(comparar);
  for (const c of candidatos) {
    if (usadoB.has(c.b.idx) || usadoL.has(c.l.idx)) continue;
    usadoB.add(c.b.idx);
    usadoL.add(c.l.idx);
    parejas.push({ b: c.b, l: c.l, categoria, metodo: typeof metodo === 'function' ? metodo(c) : metodo });
  }
}
const libresB = () => banco.filter((b) => !usadoB.has(b.idx));
const libresL = () => libros.filter((l) => !usadoL.has(l.idx));

// Paso 1 — monto exacto y fecha dentro de ±TOL_DIAS. Ante empate gana la fecha
// más cercana; luego la referencia y el nombre. Índice por monto: no compara
// todo contra todo, así aguanta miles de movimientos.
{
  const porMonto = new Map();
  for (const l of libros) {
    if (!porMonto.has(l.centavos)) porMonto.set(l.centavos, []);
    porMonto.get(l.centavos).push(l);
  }
  const cand = [];
  for (const b of banco) {
    for (const l of porMonto.get(b.centavos) || []) {
      const d = dias(b, l);
      if (d <= TOL_DIAS) cand.push({ b, l, d, ref: mismaReferencia(b, l) ? 1 : 0, sim: similitudNombre(b, l) });
    }
  }
  tomar(
    cand,
    (x, y) => x.d - y.d || y.ref - x.ref || y.sim - x.sim || x.b.idx - y.b.idx || x.l.idx - y.l.idx,
    'Conciliado',
    (c) => (c.d === 0 ? 'Monto exacto, misma fecha' : `Monto exacto, fecha corrida ${c.d} día(s)`)
  );
}

// Paso 2a — monto exacto + misma referencia, aunque la fecha se salga de la
// ventana (el cheque que el proveedor cobró una semana después).
{
  const cand = [];
  for (const b of libresB()) for (const l of libresL()) {
    if (b.centavos === l.centavos && mismaReferencia(b, l) && dias(b, l) <= TOL_DIAS_REF) cand.push({ b, l, d: dias(b, l) });
  }
  tomar(cand, (x, y) => x.d - y.d, 'Conciliado', (c) => `Monto exacto + misma referencia (fecha corrida ${c.d} días)`);
}

// Paso 2b — misma referencia pero monto distinto: es el mismo movimiento,
// digitado con otro valor.
{
  const cand = [];
  for (const b of libresB()) for (const l of libresL()) {
    if (mismoSigno(b, l) && mismaReferencia(b, l) && dias(b, l) <= TOL_DIAS_REF) cand.push({ b, l, d: dias(b, l) });
  }
  tomar(cand, (x, y) => x.d - y.d, 'Diferencia de monto', 'Misma referencia, monto distinto');
}

// Paso 3 — posibles duplicados: una fila sin pareja que es gemela de otra del
// mismo lado (mismo monto, misma fecha ±1 día, mismo nombre/memo o misma
// descripción). Se marca antes del paso 4 para que un duplicado no se
// «empareje» por parecido con otro movimiento.
const duplicados = []; // { fila, gemela }
{
  const firmaL = (l) => `${compacto(l.nombre)}|${compacto(l.memo)}|${compacto(l.num)}`;
  for (const l of libresL()) {
    const gemela = libros.find((t) => t.idx !== l.idx && t.centavos === l.centavos &&
      Math.abs(t.dia - l.dia) <= 1 && firmaL(t) === firmaL(l) && (usadoL.has(t.idx) || t.idx < l.idx));
    if (gemela) { usadoL.add(l.idx); duplicados.push({ fila: l, gemela }); }
  }
  const firmaB = (b) => compacto(b.descripcion);
  for (const b of libresB()) {
    const gemela = banco.find((t) => t.idx !== b.idx && t.centavos === b.centavos &&
      Math.abs(t.dia - b.dia) <= 1 && firmaB(t) === firmaB(b) && (usadoB.has(t.idx) || t.idx < b.idx));
    if (gemela) { usadoB.add(b.idx); duplicados.push({ fila: b, gemela }); }
  }
}

// Paso 4 — mismo nombre (el «Name» de QuickBooks aparece en el texto del
// banco), fecha dentro de la ventana y monto parecido: diferencia de monto.
{
  const cand = [];
  for (const b of libresB()) for (const l of libresL()) {
    if (!mismoSigno(b, l) || dias(b, l) > TOL_DIAS) continue;
    const sim = similitudNombre(b, l);
    const dif = Math.abs(b.centavos - l.centavos);
    const tope = (TOL_MONTO_PCT / 100) * Math.max(Math.abs(b.centavos), Math.abs(l.centavos));
    if (sim >= MIN_SIMILITUD && dif <= tope) cand.push({ b, l, sim, dif, d: dias(b, l) });
  }
  tomar(cand, (x, y) => y.sim - x.sim || x.dif - y.dif || x.d - y.d, 'Diferencia de monto', 'Mismo nombre y fecha, monto distinto');
}

// ---------- 5. Armar el detalle ----------------------------------------------
const corte = aDia(P.fecha_corte);
const esCheque = (l) => /check|cheque/i.test(l.tipo) || /^\d{3,}$/.test(compacto(l.num));

function subtipoDiferencia(dif) {
  const a = Math.abs(dif);
  if (a % 9 === 0) return 'Posible trasposición de dígitos (la diferencia es divisible entre 9)';
  if (a < 100) return 'Diferencia de centavos';
  return 'Monto distinto';
}

function accionSoloBanco(b) {
  const t = normalizar(b.descripcion);
  if (b.centavos > 0 && /INTERES/.test(t)) return 'Registrar en QuickBooks el ingreso por intereses.';
  if (/COMISION|CARGO|FEE|CUOTA|MANEJO/.test(t)) return 'Registrar en QuickBooks el gasto bancario (comisión).';
  return b.centavos > 0
    ? 'Depósito que no está en libros: identificar al cliente y registrarlo.'
    : 'Cargo que no está en libros: identificar el gasto y registrarlo.';
}

function accionSoloLibros(l) {
  const atraso = corte === null ? null : corte - l.dia;
  if (l.centavos < 0 && esCheque(l)) {
    return atraso !== null && atraso > 30
      ? `Cheque girado hace ${atraso} días y aún sin cobrar: confirmar con el proveedor.`
      : 'Cheque en tránsito: girado pero aún no cobrado. Debe aparecer en el próximo extracto.';
  }
  if (l.centavos > 0) {
    return atraso !== null && atraso > 5
      ? `Depósito registrado hace ${atraso} días que no llegó al banco: revisar.`
      : 'Depósito en tránsito: registrado al cierre, debe aparecer en el próximo extracto.';
  }
  return 'Pago registrado en libros que no salió del banco: verificar si se hizo.';
}

const vacio = {
  fecha_banco: '', descripcion_banco: '', referencia_banco: '', monto_banco: '',
  fecha_libros: '', tipo_libros: '', num_libros: '', nombre_libros: '', memo_libros: '', monto_libros: '',
};
const ladoB = (b) => ({ fecha_banco: isoDe(b.dia), descripcion_banco: b.descripcion, referencia_banco: b.referencia, monto_banco: dinero(b.centavos) });
const ladoL = (l) => ({
  fecha_libros: isoDe(l.dia), tipo_libros: l.tipo, num_libros: l.num, nombre_libros: l.nombre,
  memo_libros: l.memo, monto_libros: dinero(l.centavos),
});
const fila = (categoria, subtipo, metodo, b, l, extra) => ({
  categoria, subtipo, metodo, ...vacio, ...(b ? ladoB(b) : {}), ...(l ? ladoL(l) : {}),
  diferencia: '', dias_desfase: '', accion_sugerida: '', ...extra,
});

const detalle = [];
for (const p of parejas) {
  const dif = p.b.centavos - p.l.centavos;
  const d = dias(p.b, p.l);
  if (p.categoria === 'Conciliado') {
    detalle.push(fila('Conciliado', d === 0 ? 'Misma fecha' : 'Fecha corrida', p.metodo, p.b, p.l, {
      diferencia: '0.00', dias_desfase: String(d), accion_sugerida: 'Ninguna.',
    }));
  } else {
    detalle.push(fila('Diferencia de monto', subtipoDiferencia(dif), p.metodo, p.b, p.l, {
      diferencia: dinero(dif), dias_desfase: String(d),
      accion_sugerida: `Corregir en QuickBooks: el banco muestra ${dinero(p.b.centavos)} y los libros ${dinero(p.l.centavos)} (diferencia ${dinero(dif)}).`,
    }));
  }
}
for (const { fila: x, gemela } of duplicados) {
  const enLibros = x.origen === 'libros';
  const queGemela = enLibros ? `${isoDe(gemela.dia)} ${gemela.nombre} ${dinero(gemela.centavos)}` : `${isoDe(gemela.dia)} ${gemela.descripcion} ${dinero(gemela.centavos)}`;
  detalle.push(fila('Posible duplicado', enLibros ? 'Duplicado en libros' : 'Duplicado en el banco',
    `Gemela de: ${queGemela}`, enLibros ? null : x, enLibros ? x : null, {
      diferencia: dinero(-x.centavos),
      accion_sugerida: enLibros
        ? 'Verificar y anular en QuickBooks el registro repetido (el banco lo muestra una sola vez).'
        : 'El banco cobró dos veces lo mismo: reclamar el reverso al banco.',
    }));
}
for (const b of libresB()) {
  detalle.push(fila('Solo en banco', b.centavos > 0 ? 'Abono no registrado' : 'Cargo no registrado',
    'Sin pareja en libros', b, null, { diferencia: dinero(b.centavos), accion_sugerida: accionSoloBanco(b) }));
}
for (const l of libresL()) {
  const sub = l.centavos < 0 && esCheque(l) ? 'Cheque en tránsito' : l.centavos > 0 ? 'Depósito en tránsito' : 'Pago no reflejado';
  detalle.push(fila('Solo en libros', sub, 'Sin pareja en el banco', null, l,
    { diferencia: dinero(-l.centavos), accion_sugerida: accionSoloLibros(l) }));
}

const ORDEN = ['Diferencia de monto', 'Posible duplicado', 'Solo en banco', 'Solo en libros', 'Conciliado'];
const fechaDe = (r) => r.fecha_banco || r.fecha_libros;
detalle.sort((x, y) => ORDEN.indexOf(x.categoria) - ORDEN.indexOf(y.categoria) || fechaDe(x).localeCompare(fechaDe(y)));

// ---------- 6. Totales y conciliación de saldos --------------------------------
const suma = (arr) => arr.reduce((a, x) => a + x, 0);
const saldoIniB = aCentavos(P.saldo_inicial_banco) ?? 0;
const saldoIniL = aCentavos(P.saldo_inicial_libros) ?? 0;
const saldoFinB = saldoIniB + suma(banco.map((b) => b.centavos));
const saldoFinL = saldoIniL + suma(libros.map((l) => l.centavos));

const soloL = libresL();
const soloB = libresB();
const dupL = duplicados.filter((x) => x.fila.origen === 'libros').map((x) => x.fila);
const dupB = duplicados.filter((x) => x.fila.origen === 'banco').map((x) => x.fila);
const difs = parejas.filter((p) => p.categoria === 'Diferencia de monto');
const conc = parejas.filter((p) => p.categoria === 'Conciliado');

const depTransito = suma(soloL.filter((l) => l.centavos > 0).map((l) => l.centavos));
const chqTransito = suma(soloL.filter((l) => l.centavos < 0).map((l) => l.centavos));
const reversoDupB = -suma(dupB.map((b) => b.centavos));
const saldoAjB = saldoFinB + depTransito + chqTransito + reversoDupB;

const abonosNoReg = suma(soloB.filter((b) => b.centavos > 0).map((b) => b.centavos));
const cargosNoReg = suma(soloB.filter((b) => b.centavos < 0).map((b) => b.centavos));
const correcciones = suma(difs.map((p) => p.b.centavos - p.l.centavos));
const reversoDupL = -suma(dupL.map((l) => l.centavos));
const saldoAjL = saldoFinL + abonosNoReg + cargosNoReg + correcciones + reversoDupL;

const contar = (cat) => detalle.filter((r) => r.categoria === cat).length;
const resumen = {
  empresa: P.empresa, cuenta: P.cuenta, periodo: P.periodo, fecha_corte: isoDe(corte),
  generado: new Date().toISOString(),
  ejecucion_n8n: $execution.id,
  movimientos_banco: banco.length,
  movimientos_libros: libros.length,
  filas_ignoradas: ignoradas.length,
  conteo: {
    conciliado: contar('Conciliado'),
    conciliado_misma_fecha: conc.filter((p) => dias(p.b, p.l) === 0).length,
    conciliado_fecha_corrida: conc.filter((p) => dias(p.b, p.l) > 0).length,
    conciliado_por_referencia: conc.filter((p) => p.metodo.startsWith('Monto exacto + misma referencia')).length,
    diferencia_de_monto: contar('Diferencia de monto'),
    solo_en_banco: contar('Solo en banco'),
    solo_en_libros: contar('Solo en libros'),
    posible_duplicado: contar('Posible duplicado'),
  },
  saldos: {
    saldo_inicial_banco: aNumero(saldoIniB),
    saldo_inicial_libros: aNumero(saldoIniL),
    saldo_final_banco: aNumero(saldoFinB),
    depositos_en_transito: aNumero(depTransito),
    cheques_en_transito: aNumero(chqTransito),
    reverso_duplicados_banco: aNumero(reversoDupB),
    saldo_banco_ajustado: aNumero(saldoAjB),
    saldo_final_libros: aNumero(saldoFinL),
    abonos_no_registrados: aNumero(abonosNoReg),
    cargos_no_registrados: aNumero(cargosNoReg),
    correcciones_de_monto: aNumero(correcciones),
    reverso_duplicados_libros: aNumero(reversoDupL),
    saldo_libros_ajustado: aNumero(saldoAjL),
    saldo_conciliado: aNumero(saldoAjB),
    diferencia_sin_explicar: aNumero(saldoAjB - saldoAjL),
  },
  cuadra: saldoAjB === saldoAjL,
};

return [{ json: { resumen, detalle } }];
