// app.js
const API_URL = 'http://localhost:3000/api';
let carrito = []; 
let pagoMetodo = "NO SELECCIONADO";
let totalUSD = 0;
let totalBS = 0;

document.addEventListener('DOMContentLoaded', () => {
    // Detectar en qué pagina estamos
    if(document.getElementById('login-form')) {
        document.getElementById('login-form').addEventListener('submit', login);
    }
    if(document.getElementById('register-form')) {
        document.getElementById('register-form').addEventListener('submit', register);
    }
    if(document.getElementById('vista-inventario')) {
        initApp();
    }
});

// --- LOGIN ---
async function login(e) {
    e.preventDefault();
    const userVal = document.getElementById('usuario').value;
    const passVal = document.getElementById('contrasena').value;

    try {
        const res = await fetch(`${API_URL}/login`, {
            method:'POST', 
            headers:{'Content-Type':'application/json'}, 
            body:JSON.stringify({ usuario: userVal, contrasena: passVal })
        });
        const d = await res.json();
        
        if(d.exito) { 
            localStorage.setItem('rol', d.rol); 
            localStorage.setItem('user', d.usuario); 
            window.location.href = 'inventario.html'; 
        } else {
            alert(d.mensaje);
        }
    } catch(err) { 
        console.error(err);
        alert("Error de conexión con el servidor"); 
    }
}

// --- REGISTRO (ARREGLADO: Ahora sí guarda en la BD) ---
async function register(e) {
    e.preventDefault();
    const userVal = document.getElementById('usuario').value;
    const passVal = document.getElementById('contrasena').value;

    if(!userVal || !passVal) return alert("Complete los campos");

    try {
        const res = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario: userVal, contrasena: passVal })
        });

        const d = await res.json();

        if (res.ok) {
            alert("Usuario registrado exitosamente. Ahora puede iniciar sesión.");
            window.location.href = 'login.html'; // Redirige al login
        } else {
            alert("Error: " + d.mensaje); // Muestra si el usuario ya existe
        }
    } catch (err) {
        alert("Error al intentar registrarse");
    }
}

// --- APP PRINCIPAL (INVENTARIO) ---
function initApp() {
    const rol = localStorage.getItem('rol');
    const user = localStorage.getItem('user');
    
    // Seguridad: Si no hay usuario, devolver al login
    if(!user) {
        window.location.href='login.html';
        return;
    }
    
    // --- CONTROL DE ROLES ---
    const btnVender = document.getElementById('btn-abrir-vender');
    
    if(rol === 'admin') {
        document.body.classList.add('admin');
        // MOSTRAR controles de admin
        document.querySelectorAll('.solo-admin').forEach(el => el.style.display = 'inline-block');
        // OCULTAR botón de vender
        if(btnVender) btnVender.style.display = 'none'; 
    } else {
        // ES EMPLEADO
        document.querySelectorAll('.solo-admin').forEach(el => el.style.display = 'none');
        // MOSTRAR botón de vender
        if(btnVender) btnVender.style.display = 'inline-block';
    }

    cargarProductos();
    
    // Eventos Generales
    document.getElementById('btn-logout').addEventListener('click', cerrarSesion);
    document.getElementById('buscador').addEventListener('keyup', filtrar);
    
    // Importar Excel (Solo funcionará si el botón existe/es admin)
    const btnImp = document.getElementById('btn-importar');
    if(btnImp) {
        btnImp.onclick = () => document.getElementById('input-excel-importar').click();
        document.getElementById('input-excel-importar').onchange = importarExcel;
    }

    // Inicializar Modales
    initModalProducto();
    initFacturacion();
}

// --- CERRAR SESIÓN Y REPORTES ---
function cerrarSesion() {
    const rol = localStorage.getItem('rol');
    const usuario = localStorage.getItem('user');
    let urlReporte = '';

    if (rol === 'admin') {
        // Admin baja Inventario General
        urlReporte = `${API_URL}/reporte/inventario`;
    } else {
        // Empleado baja Reporte de sus Ventas
        urlReporte = `${API_URL}/reporte/ventas?usuario=${usuario}`;
    }

    // Descargar Excel
    const link = document.createElement('a');
    link.href = urlReporte;
    link.download = rol === 'admin' ? 'Inventario_General.xlsx' : `Ventas_${usuario}.xlsx`;
    document.body.appendChild(link);
    link.click();

    // Redirigir tras breve pausa
    setTimeout(() => { 
        localStorage.clear(); 
        window.location.href = 'login.html'; // Cambiado a login.html (o index.html si prefieres)
    }, 1500);
}

// --- PRODUCTOS ---
async function cargarProductos() {
    try {
        const res = await fetch(`${API_URL}/productos`); 
        const d = await res.json();
        const tb = document.getElementById('cuerpo-tabla'); 
        tb.innerHTML='';
        
        const isAdmin = localStorage.getItem('rol') === 'admin';
        // Si no es admin, ocultamos la columna visualmente o no generamos botones
        const displayStyle = isAdmin ? '' : 'display:none;';

        d.productos.forEach(p => {
            let botonesAdmin = '';
            if(isAdmin) {
                botonesAdmin = `
                    <td class="solo-admin">
                        <button class="btn-accion btn-edit" onclick="editProd(${p.id})">✏️</button>
                        <button class="btn-accion btn-delete" onclick="delProd(${p.id})">✖</button>
                    </td>`;
            } else {
                // Si es empleado, ponemos una celda vacía o oculta para mantener alineación si es necesario
                // Pero como en el HTML la cabecera tiene clase solo-admin, se ocultará toda la columna.
                botonesAdmin = `<td style="display:none;"></td>`; 
            }

            tb.innerHTML += `
            <tr>
                ${botonesAdmin}
                <td>${p.serial}</td>
                <td>${p.codigo}</td>
                <td>${p.descripcion}</td>
                <td>${p.modelo}</td>
                <td>${p.marca}</td>
                <td>${p.precio}$</td>
                <td>${p.cantidad}</td>
            </tr>`;
        });
    } catch(e) { console.log("Error cargando productos"); }
}

function filtrar() {
    const f = document.getElementById('buscador').value.toLowerCase();
    document.querySelectorAll('#cuerpo-tabla tr').forEach(r => {
        r.style.display = r.innerText.toLowerCase().includes(f) ? "" : "none";
    });
}

async function importarExcel(e) {
    const f = e.target.files[0]; if(!f) return;
    const fd = new FormData(); fd.append('archivo', f);
    try {
        const res = await fetch(`${API_URL}/importar`, {method:'POST', body:fd});
        const d = await res.json(); alert(d.mensaje); cargarProductos();
    } catch(err) { alert("Error subida"); }
}

// --- FACTURACIÓN ---
const modalFac = document.getElementById('modal-facturacion');
const modalList = document.getElementById('modal-lista-compras');
const modalRes = document.getElementById('modal-resumen-final');
const back = document.getElementById('modal-backdrop');

function initFacturacion() {
    // Verificar si existe botón vender (Admin no lo verá, pero evitamos error en consola)
    const btnVender = document.getElementById('btn-abrir-vender');
    if(btnVender) {
        btnVender.onclick = () => { 
            carrito=[]; 
            totalUSD=0; totalBS=0; 
            document.getElementById('form-factura').reset(); 
            actualizarDisplayMonto();
            modalFac.classList.add('visible'); back.classList.add('visible'); 
        };
    }
    
    document.getElementById('btn-cancelar-factura').onclick = () => { 
        modalFac.classList.remove('visible'); back.classList.remove('visible'); 
    };

    document.getElementById('btn-add-item').onclick = addItem;
    document.getElementById('btn-ver-lista').onclick = () => { renderLista(); modalList.classList.add('visible'); };
    document.getElementById('btn-regresar-lista').onclick = () => modalList.classList.remove('visible');
    
    document.getElementById('fac-codigo').onkeypress = (e) => { if(e.key==='Enter'){e.preventDefault(); addItem();} };

    const selDivisa = document.getElementById('fac-divisa');
    const inpMonto = document.getElementById('fac-monto-display');
    
    selDivisa.onchange = () => {
        if(selDivisa.value === 'BS') {
            inpMonto.readOnly = false; 
            inpMonto.value = totalBS > 0 ? totalBS : ""; 
            inpMonto.focus();
        } else {
            inpMonto.readOnly = true;
            inpMonto.value = totalUSD.toFixed(2);
        }
    };
    
    inpMonto.oninput = () => {
        if(selDivisa.value === 'BS') {
            totalBS = parseFloat(inpMonto.value) || 0;
        }
    };

    document.getElementById('form-factura').onsubmit = (e) => {
        e.preventDefault(); 
        if(carrito.length===0) return alert("El carrito está vacío");
        
        document.getElementById('res-cliente').innerText = document.getElementById('fac-cliente').value;
        document.getElementById('res-cedula').innerText = document.getElementById('fac-cedula').value;
        document.getElementById('res-telefono').innerText = document.getElementById('fac-telefono').value;
        
        document.getElementById('res-lista-productos').innerHTML = carrito.map(i=>`<div>• ${i.descripcion} (x${i.cantidadVenta})</div>`).join('');
        
        document.getElementById('res-total-usd').innerText = totalUSD.toFixed(2) + '$';
        document.getElementById('res-total-bs').innerText = totalBS.toFixed(2);
        
        pagoMetodo = "NO SELECCIONADO";
        document.getElementById('res-metodo-txt').innerText = "...";
        document.querySelectorAll('.btn-pago').forEach(b => b.classList.remove('activo'));
        document.getElementById('res-total-bs-container').style.display = 'none';

        modalFac.classList.remove('visible'); 
        modalRes.classList.add('visible');
    };

    document.getElementById('btn-finalizar-venta').onclick = finalizarVenta;
}

async function addItem() {
    const code = document.getElementById('fac-codigo').value; 
    const cant = parseInt(document.getElementById('fac-cant').value);
    
    if(!code) return;
    
    const res = await fetch(`${API_URL}/productos`); 
    const d = await res.json();
    const p = d.productos.find(x => x.codigo === code || x.serial === code);
    
    if(p && p.cantidad >= cant) {
        carrito.push({...p, cantidadVenta: cant}); 
        totalUSD += (p.precio * cant);
        actualizarDisplayMonto();
        
        document.getElementById('fac-codigo').value=''; 
        document.getElementById('fac-cant').value=1; 
        document.getElementById('fac-codigo').focus();
        
        alert("Producto agregado.");
    } else {
        alert("Producto no encontrado o stock insuficiente");
    }
}

function actualizarDisplayMonto() {
    const sel = document.getElementById('fac-divisa');
    const inp = document.getElementById('fac-monto-display');
    if(sel.value === 'USD') {
        inp.value = totalUSD.toFixed(2);
    } else {
        inp.value = totalBS;
    }
}

function renderLista() {
    const cont = document.getElementById('lista-items-container');
    if(carrito.length === 0) { cont.innerHTML = "<p>Carrito vacío</p>"; return; }
    
    cont.innerHTML = `
    <table style="width:100%; border-collapse: collapse;">
        <tr style="background:#ddd; font-weight:bold;"><td>Acción</td><td>Desc</td><td>Cant</td></tr>
        ${carrito.map((i, idx) => `
            <tr style="border-bottom:1px solid #ccc;">
                <td>
                    <button class="btn-rojo-x" onclick="delItem(${idx})" style="background:red; color:white; border:none; padding:5px 10px; cursor:pointer;">X</button>
                </td>
                <td>${i.descripcion}</td>
                <td>${i.cantidadVenta}</td>
            </tr>
        `).join('')}
    </table>`;
}

window.delItem = (idx) => {
    const item = carrito[idx];
    totalUSD -= (item.precio * item.cantidadVenta);
    carrito.splice(idx, 1);
    renderLista();
    actualizarDisplayMonto();
};

window.setMetodo = (m) => {
    pagoMetodo = m;
    document.getElementById('res-metodo-txt').innerText = m;
    
    document.querySelectorAll('.btn-pago').forEach(b => {
        b.classList.remove('activo');
        if(b.innerText.includes(m) || (m==='PAGO MOVIL' && b.innerText==='TRANSFERENCIA')) b.classList.add('activo');
    });

    const bsContainer = document.getElementById('res-total-bs-container');
    if (m === 'EFECTIVO') {
        bsContainer.style.display = 'none'; 
    } else {
        bsContainer.style.display = 'inline'; 
    }
};

async function finalizarVenta() {
    if(pagoMetodo === "NO SELECCIONADO") return alert("Seleccione un método de pago");

    const res = await fetch(`${API_URL}/ventas`, {
        method:'POST', headers:{'Content-Type':'application/json'}, 
        body:JSON.stringify({
            items: carrito,
            vendedor: localStorage.getItem('user'),
            cliente: document.getElementById('res-cliente').innerText,
            total_usd: totalUSD,
            total_bs: (pagoMetodo !== 'EFECTIVO') ? totalBS : 0,
            metodo: pagoMetodo
        })
    });

    if(res.ok) {
        const payload = {
            cliente: document.getElementById('res-cliente').innerText,
            cedula: document.getElementById('res-cedula').innerText,
            telefono: document.getElementById('res-telefono').innerText,
            items: carrito,
            total_usd: totalUSD.toFixed(2),
            total_bs: (pagoMetodo !== 'EFECTIVO') ? totalBS.toFixed(2) : "N/A",
            metodo: pagoMetodo
        };
        const exc = await fetch(`${API_URL}/factura`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
        const bl = await exc.blob(); 
        const l = document.createElement('a'); l.href=URL.createObjectURL(bl); l.download=`Factura_${Date.now()}.xlsx`; l.click();

        alert("Venta Finalizada Exitosamente");
        modalRes.classList.remove('visible');
        back.classList.remove('visible');
        cargarProductos(); 
    } else {
        alert("Error al procesar la venta");
    }
}

// --- MODAL PRODUCTOS (ADMIN) ---
let modProd, frmProd;
function initModalProducto() {
    modProd = document.getElementById('modal-producto'); 
    frmProd = document.getElementById('form-producto');
    
    if(!document.getElementById('btn-agregar')) return; // Seguridad si el boton no existe

    document.getElementById('btn-agregar').onclick = () => { 
        frmProd.reset(); document.getElementById('prod-id').value=''; 
        modProd.classList.add('visible'); back.classList.add('visible'); 
    };
    document.getElementById('btn-cancelar-modal').onclick = () => { 
        modProd.classList.remove('visible'); 
        if(!modalFac.classList.contains('visible')) back.classList.remove('visible'); 
    };

    frmProd.onsubmit = async (e) => {
        e.preventDefault();
        const p = { 
            serial:document.getElementById('prod-serial').value, 
            codigo:document.getElementById('prod-codigo').value, 
            descripcion:document.getElementById('prod-desc').value, 
            modelo:document.getElementById('prod-modelo').value, 
            marca:document.getElementById('prod-marca').value, 
            precio:document.getElementById('prod-precio').value, 
            cantidad:document.getElementById('prod-cant').value 
        };
        const id = document.getElementById('prod-id').value;
        const method = id ? 'PUT' : 'POST';
        const url = id ? `${API_URL}/productos/${id}` : `${API_URL}/productos`;
        
        await fetch(url, {method:method, headers:{'Content-Type':'application/json'}, body:JSON.stringify(p)});
        modProd.classList.remove('visible'); back.classList.remove('visible'); cargarProductos();
    };
}
window.editProd = async (id) => {
    const r = await fetch(`${API_URL}/productos/${id}`); const d = await r.json(); const p = d.producto;
    document.getElementById('prod-id').value=p.id; 
    document.getElementById('prod-serial').value=p.serial; 
    document.getElementById('prod-codigo').value=p.codigo; 
    document.getElementById('prod-desc').value=p.descripcion; 
    document.getElementById('prod-modelo').value=p.modelo; 
    document.getElementById('prod-marca').value=p.marca; 
    document.getElementById('prod-precio').value=p.precio; 
    document.getElementById('prod-cant').value=p.cantidad;
    modProd.classList.add('visible'); back.classList.add('visible');
};
window.delProd = async (id) => { if(confirm("¿Eliminar producto?")) { await fetch(`${API_URL}/productos/${id}`, {method:'DELETE'}); cargarProductos(); } };