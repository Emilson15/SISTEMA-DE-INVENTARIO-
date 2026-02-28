// server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const ExcelJS = require('exceljs');
const multer = require('multer');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

const upload = multer({ storage: multer.memoryStorage() });
const PUERTO = 3000;
const DB_PATH = './database.db';

// CONEXIÓN
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) console.error("Error BD:", err.message);
    else {
        console.log("Base de datos conectada.");
        db.serialize(() => {
            // Usuarios
            db.run(`CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY AUTOINCREMENT, usuario TEXT UNIQUE, contrasena TEXT, rol TEXT)`);
            // Productos
            db.run(`CREATE TABLE IF NOT EXISTS productos (id INTEGER PRIMARY KEY AUTOINCREMENT, serial TEXT UNIQUE, codigo TEXT, descripcion TEXT, modelo TEXT, marca TEXT, precio REAL, cantidad INTEGER)`);
            // VENTAS (HISTORIAL)
            db.run(`CREATE TABLE IF NOT EXISTS ventas (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
                vendedor TEXT,
                cliente TEXT,
                total_usd REAL,
                total_bs REAL,
                metodo TEXT,
                items_json TEXT
            )`);

            // Admin por defecto
            db.run(`INSERT OR IGNORE INTO usuarios (usuario, contrasena, rol) VALUES (?, ?, ?)`, ['admin', 'admin123', 'admin']);
        });
    }
});

// --- RUTAS DE AUTENTICACIÓN ---
app.post('/api/login', (req, res) => {
    const { usuario, contrasena } = req.body;
    db.get("SELECT * FROM usuarios WHERE usuario = ? AND contrasena = ?", [usuario, contrasena], (err, row) => {
        if (row) res.json({ exito: true, rol: row.rol, usuario: row.usuario });
        else res.status(401).json({ exito: false, mensaje: "Credenciales inválidas" });
    });
});

app.post('/api/register', (req, res) => {
    const { usuario, contrasena } = req.body;
    db.run(`INSERT INTO usuarios (usuario, contrasena, rol) VALUES (?, ?, 'empleado')`, [usuario, contrasena], (err) => {
        if (!err) res.json({ mensaje: "Registrado" });
        else res.status(400).json({ mensaje: "Error o usuario duplicado" });
    });
});

// --- CRUD PRODUCTOS ---
app.get('/api/productos', (req,res)=> db.all("SELECT * FROM productos ORDER BY id DESC", [], (err,r)=>res.json({productos:r})));
app.get('/api/productos/:id', (req,res)=> db.get("SELECT * FROM productos WHERE id=?", [req.params.id], (err,r)=>res.json({producto:r})));
app.post('/api/productos', (req,res)=> {
    const {serial,codigo,descripcion,modelo,marca,precio,cantidad} = req.body;
    db.run("INSERT INTO productos (serial,codigo,descripcion,modelo,marca,precio,cantidad) VALUES (?,?,?,?,?,?,?)", 
    [serial,codigo,descripcion,modelo,marca,precio,cantidad], (err)=> { if(!err) res.json({ok:true}); else res.status(400).json({error:err.message}); });
});
app.put('/api/productos/:id', (req,res)=> {
    const {serial,codigo,descripcion,modelo,marca,precio,cantidad} = req.body;
    db.run("UPDATE productos SET serial=?, codigo=?, descripcion=?, modelo=?, marca=?, precio=?, cantidad=? WHERE id=?",
    [serial,codigo,descripcion,modelo,marca,precio,cantidad,req.params.id], (err)=> { if(!err) res.json({ok:true}); else res.status(400).json({error:err.message}); });
});
app.delete('/api/productos/:id', (req,res)=> db.run("DELETE FROM productos WHERE id=?", [req.params.id], ()=>res.json({ok:true})));

// --- PROCESAR VENTA (DESCONTAR STOCK Y GUARDAR HISTORIAL) ---
app.post('/api/ventas', (req, res) => {
    const { items, vendedor, cliente, total_usd, total_bs, metodo } = req.body;
    
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        let error = false;
        
        // 1. Descontar Stock
        const stmt = db.prepare("UPDATE productos SET cantidad = cantidad - ? WHERE id = ? AND cantidad >= ?");
        items.forEach(i => {
            stmt.run([i.cantidadVenta, i.id, i.cantidadVenta], function(err) {
                if(err || this.changes === 0) error = true;
            });
        });
        stmt.finalize();

        if(error) {
            db.run("ROLLBACK");
            return res.status(400).json({ error: "Stock insuficiente" });
        }

        // 2. Guardar en Historial
        const itemsStr = JSON.stringify(items.map(i => ({desc: i.descripcion, cant: i.cantidadVenta, precio: i.precio})));
        db.run("INSERT INTO ventas (vendedor, cliente, total_usd, total_bs, metodo, items_json) VALUES (?, ?, ?, ?, ?, ?)",
            [vendedor, cliente, total_usd, total_bs, metodo, itemsStr],
            (err) => {
                if(err) {
                    db.run("ROLLBACK");
                    res.status(500).json({error: "Error guardando venta"});
                } else {
                    db.run("COMMIT");
                    res.json({exito: true});
                }
            }
        );
    });
});

// --- IMPORTAR EXCEL ---
app.post('/api/importar', upload.single('archivo'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Falta archivo" });
    try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(req.file.buffer);
        const worksheet = workbook.getWorksheet(1);
        const promesas = [];
        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber > 1) { 
                const p = {
                    serial: row.getCell(1).text, codigo: row.getCell(2).text, descripcion: row.getCell(3).text,
                    modelo: row.getCell(4).text, marca: row.getCell(5).text, precio: parseFloat(row.getCell(6).text||0), cantidad: parseInt(row.getCell(7).text||0)
                };
                promesas.push(new Promise(r => db.run("INSERT INTO productos (serial,codigo,descripcion,modelo,marca,precio,cantidad) VALUES (?,?,?,?,?,?,?)", [p.serial,p.codigo,p.descripcion,p.modelo,p.marca,p.precio,p.cantidad], ()=>r())));
            }
        });
        await Promise.all(promesas);
        res.json({ mensaje: "Importado" });
    } catch (e) { res.status(500).json({ error: "Error Excel" }); }
});

// --- GENERADOR DE EXCEL PROFESIONAL (Funciones Auxiliares) ---
function styleSheet(ws) {
    ws.getRow(1).font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF001F3F' } }; // Azul oscuro corporativo
    ws.getRow(1).alignment = { horizontal: 'center' };
}

// 1. REPORTE INVENTARIO (ADMIN)
app.get('/api/reporte/inventario', async (req, res) => {
    const productos = await new Promise(r => db.all("SELECT * FROM productos", [], (err, rows) => r(rows)));
    
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Inventario General');
    
    ws.mergeCells('A1:H1'); ws.getCell('A1').value = 'INVENTARIO GENERAL - RODAMIENTOS';
    styleSheet(ws);
    
    ws.addRow(['SERIAL', 'CÓDIGO', 'DESCRIPCIÓN', 'MODELO', 'MARCA', 'PRECIO ($)', 'STOCK', 'TOTAL ($)']);
    ws.getRow(2).font = { bold: true };
    
    let totalGlobal = 0;
    productos.forEach(p => {
        const subtotal = p.precio * p.cantidad;
        totalGlobal += subtotal;
        ws.addRow([p.serial, p.codigo, p.descripcion, p.modelo, p.marca, p.precio, p.cantidad, subtotal]);
    });
    
    ws.addRow([]); // Espacio
    ws.addRow(['','','','','','','TOTAL VALORIZADO:', totalGlobal]);
    ws.lastRow.getCell(8).font = { bold: true, color: { argb: 'FF2ECC71' } };

    ws.columns = [{width:15},{width:15},{width:40},{width:15},{width:15},{width:10},{width:10},{width:15}];
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Inventario.xlsx"`);
    await wb.xlsx.write(res); res.end();
});

// 2. REPORTE VENTAS (EMPLEADO AL CERRAR SESIÓN)
app.get('/api/reporte/ventas', async (req, res) => {
    const usuario = req.query.usuario;
    // Obtener todas las ventas de este usuario
    const ventas = await new Promise(r => db.all("SELECT * FROM ventas WHERE vendedor = ? ORDER BY fecha DESC", [usuario], (err, rows) => r(rows)));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Reporte de Ventas');

    ws.mergeCells('A1:F1'); ws.getCell('A1').value = `REPORTE DE VENTAS - ${usuario.toUpperCase()}`;
    styleSheet(ws);

    ws.addRow(['FECHA', 'CLIENTE', 'MÉTODO PAGO', 'TOTAL ($)', 'TOTAL (BS)', 'DETALLES']);
    ws.getRow(2).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3498DB' } }; // Azul claro

    let sumaUSD = 0;
    ventas.forEach(v => {
        sumaUSD += v.total_usd;
        // Formatear items
        const items = JSON.parse(v.items_json).map(i => `${i.desc} (x${i.cant})`).join(', ');
        ws.addRow([v.fecha, v.cliente, v.metodo, v.total_usd, v.total_bs, items]);
    });

    ws.addRow([]);
    ws.addRow(['','','TOTAL VENTAS:', sumaUSD]);
    ws.lastRow.getCell(4).font = { bold: true, size: 12 };

    ws.columns = [{width:20},{width:25},{width:15},{width:12},{width:12},{width:50}];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="Ventas_${usuario}.xlsx"`);
    await wb.xlsx.write(res); res.end();
});

// 3. FACTURA INDIVIDUAL (PDF/EXCEL AL FINALIZAR VENTA)
app.post('/api/factura', async (req,res) => {
    const {cliente,cedula,telefono,items,total_usd,total_bs,metodo} = req.body;
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Factura');

    ws.mergeCells('A1:E1'); ws.getCell('A1').value='RODAMIENTOS - FACTURA DE VENTA'; 
    styleSheet(ws);

    ws.getCell('A3').value=`Fecha: ${new Date().toLocaleString()}`;
    ws.getCell('A4').value=`Cliente: ${cliente}`; ws.getCell('C4').value=`CI: ${cedula}`;
    ws.getCell('A5').value=`Tel: ${telefono}`; ws.getCell('C5').value=`Pago: ${metodo}`;

    ws.addRow([]);
    ws.addRow(['Cant', 'Descripción', 'Precio Unit ($)', 'Subtotal ($)']);
    ws.getRow(7).font={bold:true}; ws.getRow(7).border = {bottom: {style:'thin'}};

    items.forEach(i => ws.addRow([i.cantidadVenta, i.descripcion, i.precio, i.precio*i.cantidadVenta]));

    ws.addRow([]);
    ws.addRow(['','','TOTAL ($):', total_usd]);
    if(metodo !== 'EFECTIVO') ws.addRow(['','','TOTAL (BS):', total_bs]);

    ws.columns = [{width:10}, {width:40}, {width:15}, {width:15}];
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res); res.end();
});

app.listen(PUERTO, () => console.log(`Servidor corriendo en http://localhost:${PUERTO}`));