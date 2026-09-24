// Organizador de cables para pegar o atornillar bajo la mesa — Forja3D (MIT)
// Se imprime tal cual: la cara plana (la que va contra la mesa) apoyada en la cama. Sin soportes.

/* [Canales] */
// Número de cables
cables = 4; // [1:1:10]
// Diámetro de cada cable (mm)
diametro_cable = 6; // [3:0.5:12]
// Holgura del canal (mm)
holgura = 0.4; // [0.1:0.1:1]
// Ancho de la abertura para meter el cable (% del diámetro; ≥ 72 evita voladizos)
abertura = 75; // [40:5:90]

/* [Pieza] */
// Largo del organizador (mm)
largo = 20; // [10:1:60]
// Grosor mínimo de pared (mm)
pared = 2; // [1.2:0.2:4]
// Pestañas con agujeros para tornillo (además de cinta adhesiva)
con_tornillos = true;

/* [Hidden] */
$fn = 48;
d = diametro_cable + holgura;
paso = d + pared;
ancho_cuerpo = cables * paso + pared;
alto = pared + d + pared / 2;
pestana = con_tornillos ? 12 : 0;
ancho_total = ancho_cuerpo + 2 * pestana;

difference() {
  union() {
    // Cuerpo con los canales
    translate([pestana, 0, 0]) cube([ancho_cuerpo, largo, alto]);
    // Pestañas planas para los tornillos
    if (con_tornillos) cube([ancho_total, largo, pared]);
  }
  for (i = [0 : cables - 1]) {
    cx = pestana + pared + d / 2 + i * paso;
    // Canal del cable (el centro queda por debajo de la cara superior)
    translate([cx, -1, pared + d / 2]) rotate([-90, 0, 0]) cylinder(d = d, h = largo + 2);
    // Abertura superior para meter el cable a presión
    translate([cx - d * abertura / 200, -1, pared + d / 2]) cube([d * abertura / 100, largo + 2, alto]);
  }
  if (con_tornillos)
    for (x = [pestana / 2, ancho_total - pestana / 2])
      translate([x, largo / 2, 0]) {
        translate([0, 0, -1]) cylinder(d = 3.4, h = pared + 2);
        // Avellanado abierto hacia arriba (la cabeza del tornillo queda al ras)
        translate([0, 0, pared - 1.6]) cylinder(d1 = 3.4, d2 = 7, h = 1.61);
      }
}
