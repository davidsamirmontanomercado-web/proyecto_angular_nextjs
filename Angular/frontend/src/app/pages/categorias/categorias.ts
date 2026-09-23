import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { NavbarComponent } from '../../shared/navbar/navbar';
import { FooterComponent } from '../../shared/footer/footer';

@Component({
  selector: 'app-categorias',
  imports: [RouterLink, NavbarComponent, FooterComponent],
  templateUrl: './categorias.html',
  styleUrl: './categorias.css'
})
export class CategoriasComponent {
  categorias = [
    { ic: '🏭', name: 'Maquinaria industrial', sub: 'Tornos · Fresadoras · CNC' },
    { ic: '💻', name: 'Tecnología y electrónica', sub: 'Computadores · Redes' },
    { ic: '🪑', name: 'Muebles y oficina', sub: 'Escritorios · Sillas · Vitrinas' },
    { ic: '🔧', name: 'Herramientas', sub: 'Manuales · Eléctricas' },
    { ic: '🏗️', name: 'Construcción', sub: 'Materiales · Acabados' },
    { ic: '⚡', name: 'Electricidad', sub: 'Cables · Iluminación' },
    { ic: '🚗', name: 'Vehículos y transporte', sub: 'Automóviles · Camiones' },
    { ic: '📦', name: 'Empaque y embalaje', sub: 'Cajas · Empaques' },
    { ic: '👕', name: 'Ropa y textiles', sub: 'Empresarial · Calzado' },
    { ic: '👗', name: 'Moda y belleza ', sub: 'Vestidos · Maquillaje · Cuidado personal' },
    { ic: '🍽️', name: 'Alimentos y bebidas', sub: 'Carnes · Bebidas' },
    { ic: '🧴', name: 'Limpieza e higiene', sub: 'Detergentes · Insumos' },
    { ic: '🏥', name: 'Salud y equipos médicos', sub: 'Equipos · Mobiliario' },
    { ic: '🌱', name: 'Agricultura', sub: 'Insumos · Riego' },
    { ic: '🧪', name: 'Químicos industriales', sub: 'Lubricantes · Resinas' },
    { ic: '📢', name: 'Publicidad y merchandising', sub: 'Avisos · Vallas' },
    { ic: '🏠', name: 'Hogar', sub: 'Electrodomésticos · Cocina' },
    { ic: '♻️', name: 'Productos usados', sub: 'Maquinaria · Equipos' },
    { ic: '💼', name: 'Servicios empresariales', sub: 'Consultoría · Contabilidad' },
    { ic: '🖥️', name: 'Servicios tecnológicos', sub: 'Software · Cloud' },
    { ic: '📈', name: 'Marketing y ventas', sub: 'Digital · Redes' },
    { ic: '🚚', name: 'Transporte y logística', sub: 'Carga · Mensajería' },
    { ic: '⚙️', name: 'Servicios industriales', sub: 'Mantenimiento' },
    { ic: '🛡️', name: 'Servicios para empresas', sub: 'Seguridad · Aseo' },
    { ic: '🎓', name: 'Educación y capacitación', sub: 'Cursos · Formación' },
    { ic: '🎬', name: 'Eventos y producción', sub: 'Fotografía · Streaming' },
    { ic: '🛠️', name: 'Fabricación y personalización', sub: 'Bajo pedido · 3D' }
  ];
}