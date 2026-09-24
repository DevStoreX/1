// Soporte de celular para escritorio — Forja3D (MIT)
// Se imprime tal cual, sin soportes. PLA o PETG, 3 paredes, 15 % de relleno.

/* [Celular] */
// Grosor del celular con funda (mm)
grosor_celular = 12; // [6:0.5:20]
// Ancho del soporte (mm)
ancho = 75; // [50:1:120]

/* [Soporte] */
// Inclinación del respaldo desde la vertical (grados)
angulo = 20; // [5:1:40]
// Altura del respaldo (mm)
alto_respaldo = 85; // [50:1:140]
// Altura del labio frontal que sujeta el celular (mm)
labio = 12; // [6:1:25]
// Grosor de las paredes (mm)
pared = 4; // [2.4:0.2:8]
// Hueco en el labio para el cable de carga
hueco_cable = true;
// Ancho del hueco para el cable (mm)
ancho_hueco = 16; // [8:1:30]

/* [Hidden] */
$fn = 64;
y_respaldo = pared + grosor_celular;
grosor_horizontal = pared / cos(angulo);
avance = alto_respaldo * tan(angulo);
profundidad = y_respaldo + grosor_horizontal + avance * 0.8 + 12;

module perfil() {
  union() {
    square([profundidad, pared]);                       // base
    square([pared, pared + labio]);                     // labio frontal
    polygon([                                            // respaldo inclinado
      [y_respaldo, 0],
      [y_respaldo + grosor_horizontal, 0],
      [y_respaldo + grosor_horizontal + avance, alto_respaldo],
      [y_respaldo + avance, alto_respaldo]
    ]);
    polygon([                                            // refuerzo trasero
      [y_respaldo + grosor_horizontal, 0],
      [y_respaldo + grosor_horizontal + avance * 0.55, alto_respaldo * 0.55],
      [profundidad, pared],
      [profundidad, 0]
    ]);
  }
}

module soporte() {
  difference() {
    // El perfil 2D (Y, Z) se extruye a lo largo de X
    rotate([90, 0, 90]) linear_extrude(ancho) perfil();
    if (hueco_cable)
      translate([(ancho - ancho_hueco) / 2, -1, -1])
        cube([ancho_hueco, y_respaldo + 1.01, pared + labio + 2]);
  }
}

soporte();
