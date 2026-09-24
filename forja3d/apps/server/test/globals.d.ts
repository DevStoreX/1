// En las pruebas leemos respuestas JSON sin declarar cada forma.
declare global {
  interface Response {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    json(): Promise<any>;
  }
}
export {};
