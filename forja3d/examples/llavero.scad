// Llavero con nombre — Forja3D (MIT). Ideal para empezar con niños.

// Texto del llavero
texto = "FORJA"; // 
// Tamaño de las letras (mm)
tamano = 10; // [6:0.5:20]
// Grosor de la placa (mm)
grosor = 3; // [2:0.2:6]
// Relieve de las letras (mm)
relieve = 1.2; // [0.6:0.2:3]
// Margen alrededor del texto (mm)
margen = 3; // [1:0.5:8]
// Estilo de letra
fuente = "Liberation Sans:style=Bold"; // [Liberation Sans:style=Bold, Liberation Serif:style=Bold, Liberation Mono:style=Bold]

/* [Hidden] */
$fn = 48;
largo = len(texto) * tamano * 0.78 + 2 * margen + 8;
alto = tamano + 2 * margen;

difference() {
  hull() {
    translate([alto / 2, alto / 2, 0]) cylinder(d = alto, h = grosor);
    translate([largo - alto / 2, alto / 2, 0]) cylinder(d = alto, h = grosor);
  }
  // Agujero para la argolla
  translate([alto / 2, alto / 2, -1]) cylinder(d = 4.5, h = grosor + 2);
}
translate([alto / 2 + 5, alto / 2, grosor - 0.01])
  linear_extrude(relieve) text(texto, size = tamano, font = fuente, halign = "left", valign = "center");
