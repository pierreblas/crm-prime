-- Formularios de Meta: si un formulario sin regla (nuevo) entra solo o espera a que lo activen.
ALTER TABLE "meta_pages" ADD COLUMN "newFormsEnter" BOOLEAN NOT NULL DEFAULT true;
