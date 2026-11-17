# Conciliación bancaria automática con n8n · Automated bank reconciliation with n8n

> Demo de portafolio con **datos 100 % ficticios** («Ejemplo Construcciones LLC», «Banco Ficticio»).
> Portfolio demo built with **100 % fictitious data**.

[Español](#español) · [English](#english)

---

## Español

### Qué problema resuelve

Cada mes alguien tiene que poner lado a lado el **extracto del banco** y los **movimientos
registrados en QuickBooks** y explicar por qué los dos saldos no coinciden: el cheque que
el proveedor todavía no cobró, la comisión que el banco descontó y nadie registró, el
depósito que se digitó con dos números al revés, el gasto que se cargó dos veces.

Hecho a mano, con 40 movimientos es una hora de trabajo; con 400, una tarde. Este flujo de
n8n lo hace en segundos: lee los dos archivos, empareja lo que coincide, clasifica lo que
no y entrega un **reporte de diferencias** con la acción sugerida para cada una y la
conciliación de saldos cuadrada al centavo.

### Qué hay en la carpeta

```
n8n-demo-conciliacion/
├── data/
│   ├── banco.csv                   extracto del banco (40 movimientos)
│   └── quickbooks.csv              export de QuickBooks (40 movimientos)
├── workflow/
│   ├── conciliacion_bancaria.json  EL FLUJO — se importa en cualquier n8n
│   └── codigo/
│       ├── conciliar.js            copia legible del nodo «Conciliar»
│       └── reporte_html.js         copia legible del nodo «Armar reporte HTML»
├── scripts/armar_workflow.mjs      vuelve a armar el JSON desde workflow/codigo/
├── output/
│   ├── reporte_conciliacion.csv    detalle línea por línea (sale de la ejecución real)
│   ├── reporte_conciliacion.html   resumen + tablas por categoría (ídem)
│   └── ultima_ejecucion.log        volcado completo de la ejecución (no se sube al repositorio)
├── correr_demo.sh                  importa y ejecuta el flujo sin abrir el editor
├── package.json                    n8n fijado en una versión exacta (2.45.7), instalado local
└── package-lock.json               árbol exacto de dependencias para `npm ci`
```

### Cómo funciona el flujo, nodo por nodo

```
Inicio manual → Parámetros → Leer CSV del banco y de QuickBooks → Extraer filas del CSV → Conciliar ─┬→ Separar detalle en filas → Detalle a CSV  → Guardar reporte CSV
                                                                                                    └→ Armar reporte HTML       → HTML a archivo → Guardar reporte HTML
```

| # | Nodo (tipo en n8n) | Qué hace |
|---|---|---|
| 1 | **Inicio manual** (Manual Trigger) | Arranca el flujo. En producción se cambia por un disparador de correo, Drive o calendario (ver más abajo). |
| 2 | **Parámetros** (Edit Fields / Set) | Lo único que se edita sin tocar código: empresa, cuenta, periodo, fecha de corte, saldos iniciales y tolerancias (±3 días, 15 días para cheques, 10 % de monto). `carpeta` es la raíz de la demo; `.` significa «la carpeta desde donde se arrancó n8n». |
| 3 | **Leer CSV del banco y de QuickBooks** (Read/Write Files from Disk) | Lee `data/{banco,quickbooks}.csv` con un solo patrón: salen dos items, cada uno con su archivo. |
| 4 | **Extraer filas del CSV** (Extract From File → CSV) | Convierte cada archivo en filas: 80 items (40 + 40). |
| 5 | **Conciliar** (Code, JavaScript) | El corazón: normaliza fechas y montos, empareja, clasifica y calcula la conciliación de saldos. Devuelve un item `{ resumen, detalle }`. |
| 6 | **Separar detalle en filas** (Split Out) | Convierte la lista `detalle` en un item por línea del reporte. |
| 7 | **Detalle a CSV** (Convert to File → CSV) | Arma el archivo CSV. |
| 8 | **Guardar reporte CSV** (Read/Write Files from Disk → Write) | Escribe `output/reporte_conciliacion.csv`. |
| 9 | **Armar reporte HTML** (Code, JavaScript) | Arma una página HTML autocontenida (sin internet, imprimible a PDF): estado, tarjetas por categoría, conciliación de saldos y una tabla por categoría. Escapa todo texto de los CSV. |
| 10 | **HTML a archivo** (Convert to File → Text) | Convierte el texto HTML en archivo. |
| 11 | **Guardar reporte HTML** (Read/Write Files from Disk → Write) | Escribe `output/reporte_conciliacion.html`. |

### Las reglas de conciliación (nodo «Conciliar»)

Todo el dinero se maneja en **centavos enteros** para que nunca aparezca un
`0.30000000000000004` en un reporte contable. Fechas de QuickBooks (`MM/DD/YYYY`) y del
banco (`YYYY-MM-DD`) se llevan a un mismo número de día; montos como `"8,400.00"`,
`$1,234.56` o `(1,234.56)` se entienden.

1. **Monto exacto y fecha dentro de ±3 días.** Si hay varias opciones, gana la fecha más
   cercana; en empate, la que coincide en referencia y nombre. Se indexa por monto, así
   que no compara todo contra todo (aguanta miles de movimientos).
2. **Referencia.** (a) Monto exacto + mismo número de cheque aunque la fecha se salga de la
   ventana (hasta 15 días): conciliado. (b) Mismo número de cheque con monto distinto:
   **diferencia de monto**.
3. **Posibles duplicados.** Una fila sin pareja que es gemela de otra del mismo lado (mismo
   monto, misma fecha ±1 día, mismo nombre y memo). Se revisa antes del paso 4 para que un
   duplicado no se empareje «por parecido» con otro movimiento.
4. **Nombre.** El «Name» de QuickBooks aparece en el texto del banco, la fecha está en la
   ventana y el monto difiere menos de 10 %: **diferencia de monto**. Si la diferencia es
   divisible entre 9 se marca como posible **trasposición de dígitos** (4,650 ↔ 4,560).
5. **Lo que sobra:** **solo en banco** (comisiones, intereses) o **solo en libros**
   (cheques en tránsito, depósitos en tránsito), cada uno con su acción sugerida.

Por último arma la **conciliación de saldos** de los dos lados y verifica que lleguen al
mismo número. Si queda dinero sin explicar, el reporte lo dice en rojo.

### Cómo correrlo

Requisitos: **Node.js 24 o superior** (la serie 2.x de n8n lo exige en su `package.json`;
probado con Node 26.5.0) y **~3 GB libres**: `node_modules` ocupa 2,6 GB. No se instala
nada global, nada pide contraseña y no se crea ninguna cuenta.

```bash
cd n8n-demo-conciliacion
npm ci --ignore-scripts    # instala n8n 2.45.7 SOLO dentro de esta carpeta, sin compilar nada
npm rebuild sqlite3        # baja el binario oficial de sqlite3 (la base local de n8n)
./correr_demo.sh           # arma, importa y ejecuta el flujo; deja los reportes en output/
open output/reporte_conciliacion.html
```

Salida esperada de `./correr_demo.sh` (el número de ejecución sube cada vez):

```
▸ 3/3 Ejecutando el flujo (id ConciliacionDemo)
  ejecución n8n #3 · estado: success · 11 nodos
  conciliados 32 · diferencias de monto 4 · solo en banco 4 · solo en libros 3 · posibles duplicados 1
  saldo conciliado 40632.03 · diferencia sin explicar 0.00
✔ Listo. Reportes en output/
```

**Por qué `--ignore-scripts`.** Un `npm install n8n` normal intenta compilar desde el código
fuente un cliente de Kafka (`@confluentinc/kafka-javascript`) que no trae binario listo para
Node 26; esa compilación lanza cientos de procesos y en una Mac de 8 GB tumbó la instalación
(`fork: Resource temporarily unavailable`). Este flujo no usa Kafka, así que se instala sin
scripts y se reconstruye solo `sqlite3`. `isolated-vm`, que n8n usa para evaluar
expresiones, ya trae binario para Node 26. De paso no corre el script de analítica de un
paquete (`@scarf/scarf`).

**Avisos normales al ejecutar:** `Failed to start Python task runner…` (no hay entorno de
Python y el flujo solo usa JavaScript) y un `ExperimentalWarning` de `localStorage` de Node 26.
Mientras corre, n8n abre su canal interno de *task runners* solo en `127.0.0.1:5679`.

Lo que hace `correr_demo.sh`, por si se quiere correr a mano:

```bash
export N8N_USER_FOLDER="$PWD"                                   # n8n guarda su base en ./.n8n
export N8N_RESTRICT_FILE_ACCESS_TO="$PWD/data;$PWD/output"      # el nodo de disco solo toca estas carpetas
export N8N_DIAGNOSTICS_ENABLED=false N8N_VERSION_NOTIFICATIONS_ENABLED=false N8N_TEMPLATES_ENABLED=false
export N8N_LOG_LEVEL=info   # n8n imprime el resultado de «execute» en nivel info; con «warn» no muestra nada

node scripts/armar_workflow.mjs
./node_modules/.bin/n8n import:workflow --input=workflow/conciliacion_bancaria.json
./node_modules/.bin/n8n execute --id=ConciliacionDemo --rawOutput > output/ultima_ejecucion.log
```

El `id` del flujo es fijo (`ConciliacionDemo`) dentro del JSON, por eso `execute --id` lo
encuentra sin consultar la base.

**Importarlo en otro n8n** (n8n Cloud, Docker, escritorio): menú *Import from File* →
`workflow/conciliacion_bancaria.json`. Copiar los dos CSV a una carpeta que ese n8n pueda
leer (en Docker, por defecto `/home/node/.n8n-files`) y poner esa ruta en el campo
`carpeta` del nodo **Parámetros**.

**Cambiar la lógica:** editar `workflow/codigo/*.js` y correr `node scripts/armar_workflow.mjs`
(lo hace solo `correr_demo.sh`). Así el JavaScript se revisa como archivo normal y el JSON
nunca queda desactualizado.

### Qué diferencias tienen los datos de ejemplo (puestas a propósito)

| Tipo | Movimiento | Banco | QuickBooks | Qué debe concluir el flujo |
|---|---|---|---|---|
| Solo en banco | Comisión por chequera nueva (12-oct) | −48.00 | — | Registrar el gasto bancario |
| Solo en banco | Comisión por transferencia enviada (15-oct) | −25.00 | — | Registrar el gasto bancario |
| Solo en banco | Comisión de manejo de cuenta (31-oct) | −35.00 | — | Registrar el gasto bancario |
| Solo en banco | Intereses ganados (31-oct) | +12.47 | — | Registrar el ingreso |
| Solo en libros | Cheque 1050 · Pinturas Arcoíris (29-oct) | — | −1,875.00 | Cheque en tránsito |
| Solo en libros | Cheque 1051 · Electricidad Volta (30-oct) | — | −640.00 | Cheque en tránsito |
| Solo en libros | Depósito · Local Comercial Avenida 5 (31-oct) | — | +3,150.00 | Depósito en tránsito |
| Dígitos invertidos | Depósito · Residencial Los Pinos (8-oct) | +4,560.00 | +4,650.00 | Diferencia −90.00, divisible entre 9 |
| Dígitos invertidos | Cheque 1047 · Concretos Andinos | −1,327.00 | −1,372.00 | Diferencia 45.00, empatado por número de cheque |
| Dígitos invertidos (centavos) | Telefonía Móvil Conecta (24-oct) | −310.45 | −310.54 | Diferencia 0.09 |
| Centavos | Suministros de Oficina Punto Fijo (21-oct) | −89.99 | −90.00 | Diferencia 0.01 (redondeo) |
| Duplicado | Ferretería La Escuadra · tornillería (13-oct) | −428.90 una vez | −428.90 dos veces | Anular el registro repetido |
| Fecha corrida 1–3 días | 21 movimientos (cheques, compras con tarjeta, depósitos) | | | Conciliados igual |
| Fecha corrida 6 días | Cheque 1043 · Alquiler de Equipos Delta | 9-oct | 3-oct | Conciliado por número de cheque |
| Trampa | Dos depósitos de 8,400.00 y dos transferencias de 5,000.00 en el mes | | | Cada uno con su pareja de fecha más cercana |

### Qué encontró la ejecución real

Ejecutado el 2026-11-17 con **n8n 2.45.7 sobre Node 26.5.0**, por línea de comandos
(`n8n execute`, modo `cli`, sin abrir el editor). Los 11 nodos terminaron en `success`; la
ejecución completa tomó menos de un segundo.

| Nodo | Items que salieron |
|---|---|
| Inicio manual · Parámetros | 1 · 1 |
| Leer CSV del banco y de QuickBooks | 2 (un archivo cada uno) |
| Extraer filas del CSV | 80 (40 + 40) |
| Conciliar | 1 (`resumen` + `detalle`) |
| Separar detalle en filas → Detalle a CSV → Guardar | 44 → 1 → 1 |
| Armar reporte HTML → HTML a archivo → Guardar | 1 → 1 → 1 |

| Categoría | Líneas | Dinero |
|---|---|---|
| Conciliado | **32** | 10 con la misma fecha, 21 con 1–3 días de diferencia y 1 por número de cheque (6 días) |
| Diferencia de monto | **4** | ajuste neto −$44.90 (3 posibles trasposiciones, 1 de centavos) |
| Solo en banco | **4** | comisiones −$108.00 · intereses +$12.47 |
| Solo en libros | **3** | cheques en tránsito −$2,515.00 · depósito en tránsito +$3,150.00 |
| Posible duplicado | **1** | reverso +$428.90 |

**Conciliación de saldos** (saldo inicial de los dos lados: $48,250.00):

| Lado del banco | | Lado de los libros (QuickBooks) | |
|---|---:|---|---:|
| Saldo según extracto | $39,997.03 | Saldo según libros | $40,343.56 |
| (+) Depósitos en tránsito | $3,150.00 | (+) Intereses sin registrar | $12.47 |
| (−) Cheques en tránsito | −$2,515.00 | (−) Comisiones sin registrar | −$108.00 |
| | | (±) Correcciones de monto | −$44.90 |
| | | (+) Reverso del duplicado | $428.90 |
| **Saldo bancario ajustado** | **$40,632.03** | **Saldo en libros ajustado** | **$40,632.03** |

**Diferencia sin explicar: $0.00.** Las 12 diferencias puestas a propósito aparecen cada una
en su categoría, sin falsos positivos. Los dos depósitos de 8,400.00 y las dos transferencias
de 5,000.00 quedaron cada uno con su pareja correcta. Las cifras coinciden con un cálculo
independiente hecho aparte, fuera de n8n.

### Cómo adaptarlo a datos reales

**QuickBooks Online.** Hay dos caminos:

- *Export manual:* Reportes → **Transaction List by Date** (o *Transaction Detail by
  Account*) filtrado por la cuenta del banco y el mes → exportar. El reporte trae filas de
  título arriba: en el nodo *Extract From File* se usa la opción **Starting Line** (o
  **Range** si se deja en Excel y se cambia la operación a XLSX) para empezar en la fila de
  encabezados. Las filas «Total» que vienen abajo el código ya las ignora (no tienen
  fecha válida), y acepta tanto `Memo` como `Memo/Description`.
- *Automático:* cambiar el nodo de lectura por el nodo **QuickBooks Online** de n8n
  (credencial OAuth2 de Intuit), recurso *Transaction → Get Report*, que consulta el
  reporte `TransactionList` con filtro de fechas. Hay que mapear sus columnas a
  `Date / Transaction Type / Num / Name / Memo / Amount` con un nodo *Edit Fields*.

**Banco.** Cada banco exporta distinto. El flujo reconoce el extracto por las columnas
`fecha, descripcion, referencia, monto`. Si el banco trae otras (`Date, Description,
Amount` o débito y crédito en columnas separadas), se agrega un nodo *Edit Fields* antes de
*Conciliar* que las renombre o calcule `monto = crédito − débito`. Fechas `DD/MM/YYYY` se
indican en el parámetro `fechas_con_barras`.

**Disparadores en vez del clic manual:**

- **Correo:** *Email Trigger (IMAP)* o *Gmail Trigger* filtrando los correos del banco con
  el extracto adjunto; el adjunto entra directo a *Extract From File*.
- **Carpeta de Google Drive:** *Google Drive Trigger* con el evento *File Created* sobre
  la carpeta «Extractos», seguido de *Google Drive → Download* y *Extract From File*.
- **Cierre de mes:** *Schedule Trigger* el día 1 a las 7:00 que traiga el reporte de
  QuickBooks por API.

**Salida:** además de guardar los archivos, enviar el HTML por *Gmail*/*Outlook*, publicar
el resumen en *Slack* o subir los reportes a Drive. Registrar las comisiones en QuickBooks
también se puede automatizar, pero conviene que una persona apruebe antes (por ejemplo,
con un paso de aprobación por correo): el flujo **sugiere**, el contador **decide**.

### Límites honestos

- Es una demo: un banco, una cuenta, un mes, archivos limpios. Con extractos reales hay
  que ajustar el mapeo de columnas por banco.
- El empate por nombre es por palabras compartidas, no por inteligencia artificial: «PAGO
  ACH 77812» sin nombre no se empata por nombre (sí por monto y fecha).
- Los saldos iniciales se escriben en *Parámetros*; un flujo real los tomaría del cierre
  del mes anterior.
- Los pagos agrupados (un depósito del banco que corresponde a varias facturas en libros)
  no se resuelven: quedan como «solo en banco» / «solo en libros» para revisión manual.

---

## English

### What it solves

Every month someone has to put the **bank statement** next to the **transactions recorded
in QuickBooks** and explain why the balances differ: checks not yet cashed, bank fees nobody
recorded, a deposit typed with two digits swapped, an expense entered twice. This n8n
workflow does it in seconds: it reads both files, matches what agrees, classifies what
doesn't, and writes a **differences report** with a suggested action per line and a
two-sided balance reconciliation that ties out to the cent.

### How the workflow works

```
Manual Trigger → Parameters (Set) → Read/Write Files from Disk → Extract From File (CSV) → Code "Conciliar" ─┬→ Split Out → Convert to File (CSV)  → Write file
                                                                                                           └→ Code "HTML report" → Convert to File (Text) → Write file
```

- **Parámetros (Set):** company, account, period, cut-off date, opening balances and
  tolerances. No code needed to change them.
- **Read/Write Files from Disk:** one glob, `data/{banco,quickbooks}.csv`, two binary items.
- **Extract From File (CSV):** 80 rows (40 + 40).
- **Code "Conciliar" (JavaScript):** money handled as integer cents; dates normalized.
  Matching rules, in order: (1) exact amount and date within ±3 days, closest date wins;
  (2) same check number — exact amount even outside the window (≤15 days) is *reconciled*,
  different amount is an *amount difference*; (3) *possible duplicates* — an unmatched row
  that is an identical twin of another row on the same side; (4) QuickBooks *Name* found in
  the bank description, same date window, amount within 10 % → *amount difference* (flagged
  as a likely **transposition** when the difference is divisible by 9); (5) leftovers →
  *bank only* (fees, interest) or *books only* (outstanding checks, deposits in transit).
  Then it builds the bank-side and book-side reconciliation and checks they agree.
- **Split Out → Convert to File → Write:** `output/reporte_conciliacion.csv`, one row per line.
- **Code "HTML report" → Convert to File (Text) → Write:** `output/reporte_conciliacion.html`,
  a self-contained page (no internet needed, prints to PDF) with status, category cards,
  balance reconciliation and one table per category. All CSV text is HTML-escaped.

### Run it

Requires **Node.js ≥ 24** (n8n 2.x requirement; tested with Node 26.5.0) and ~3 GB of free
disk (`node_modules` is 2.6 GB). Nothing global, no accounts.

```bash
npm ci --ignore-scripts    # installs n8n 2.45.7 locally, compiling nothing
npm rebuild sqlite3        # fetches the official sqlite3 binary (n8n's local database)
./correr_demo.sh           # builds, imports and executes the workflow (no web editor)
open output/reporte_conciliacion.html
```

Why `--ignore-scripts`: a plain install tries to compile a Kafka client from source (no
prebuilt binary for Node 26), which spawned hundreds of processes and failed on an 8 GB Mac.
This workflow doesn't use Kafka, so only `sqlite3` is rebuilt. Expected noise when running:
a "Failed to start Python task runner" warning (the flow only uses JavaScript) and a Node 26
`localStorage` ExperimentalWarning.

Manual equivalent: set `N8N_USER_FOLDER="$PWD"`,
`N8N_RESTRICT_FILE_ACCESS_TO="$PWD/data;$PWD/output"` and `N8N_LOG_LEVEL=info` (the
`execute` result is printed at info level), then
`./node_modules/.bin/n8n import:workflow --input=workflow/conciliacion_bancaria.json` and
`./node_modules/.bin/n8n execute --id=ConciliacionDemo --rawOutput`.

To use it in another n8n instance: *Import from File*, copy the CSVs to a folder that
instance can read, and set that path in the `carpeta` field of the **Parámetros** node.

### Planted differences in the sample data

4 bank-only items (three fees, one interest credit), 3 books-only items (two outstanding
checks, one deposit in transit), 4 amount differences (two whole-number transpositions,
one cents transposition, one 1-cent rounding), 1 duplicate entry in QuickBooks, 21 matches
with a 1–3 day date lag, one check that cleared 6 days later (matched by check number), and
repeated amounts (two 8,400.00 deposits, two 5,000.00 transfers) to test that each one finds
its closest-date match. See the Spanish table above for the line-by-line list.

### Results of the real run

Run on 2026-11-17 with **n8n 2.45.7 on Node 26.5.0** through the CLI (`n8n execute`, no
editor). All 11 nodes finished with `success` in under a second; 80 rows in, 44 report lines out.

| Category | Lines | Money |
|---|---|---|
| Reconciled | **32** | 10 same date, 21 with a 1–3 day lag, 1 by check number (6 days) |
| Amount difference | **4** | net adjustment −$44.90 (3 likely transpositions, 1 cents) |
| Bank only | **4** | fees −$108.00 · interest +$12.47 |
| Books only | **3** | outstanding checks −$2,515.00 · deposit in transit +$3,150.00 |
| Possible duplicate | **1** | reversal +$428.90 |

Bank balance $39,997.03 → adjusted **$40,632.03**; book balance $40,343.56 → adjusted
**$40,632.03**; **unexplained difference $0.00**. Every planted difference landed in its
category with no false positives, and the totals match an independent calculation done
outside n8n.

### Adapting it to real data

- **QuickBooks Online:** export *Transaction List by Date* for the bank account (use the
  *Starting Line* / *Range* option to skip the title rows; "Total" rows are already ignored),
  or replace the file read with n8n's **QuickBooks Online** node, *Transaction → Get Report*
  (`TransactionList`), and map its columns with *Edit Fields*.
- **Bank:** rename the bank's columns to `fecha, descripcion, referencia, monto` (or compute
  `monto = credit − debit`) with an *Edit Fields* node.
- **Triggers:** *Email Trigger (IMAP)* / *Gmail Trigger* for statements arriving by email,
  *Google Drive Trigger* (*File Created*) for a statements folder, or a monthly
  *Schedule Trigger*. Send the HTML by email or Slack. Posting fees back to QuickBooks is
  possible, but keep a human approval step: the workflow suggests, the accountant decides.

### Honest limits

Single bank account and month, clean files; name matching is word overlap, not AI; opening
balances are typed in *Parámetros*; one-to-many matches (one bank deposit covering several
invoices) are left for manual review.
