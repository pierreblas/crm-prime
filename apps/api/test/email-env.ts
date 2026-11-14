// Entorno de las pruebas del correo. Va en su propio módulo, importado el
// primero: el modo SaaS y las claves se leen al cargar los módulos del servicio.
process.env.TENANCY_MODE = "multi";
process.env.APP_ENCRYPTION_KEY = "clave-de-prueba-del-correo";
process.env.API_PUBLIC_URL = "https://api.driony.test";
