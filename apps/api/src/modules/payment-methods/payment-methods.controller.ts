import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import {
  Role,
  createPaymentMethodSchema,
  updatePaymentMethodSchema,
  type CreatePaymentMethodInput,
  type UpdatePaymentMethodInput,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";
import { PaymentMethodsService } from "./payment-methods.service";

const reorderSchema = z.object({ ids: z.array(z.string()).min(1).max(100) });

/** Cuentas y números a los que pagan los clientes: solo administradores. */
@Controller("payment-methods")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class PaymentMethodsController {
  constructor(private readonly methods: PaymentMethodsService) {}

  @Get()
  list() {
    return this.methods.list();
  }

  @Post()
  create(@Body(new ZodValidationPipe(createPaymentMethodSchema)) body: CreatePaymentMethodInput) {
    return this.methods.create(body);
  }

  @Post("reorder")
  reorder(@Body(new ZodValidationPipe(reorderSchema)) body: { ids: string[] }) {
    return this.methods.reorder(body.ids);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body(new ZodValidationPipe(updatePaymentMethodSchema)) body: UpdatePaymentMethodInput) {
    return this.methods.update(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.methods.remove(id);
  }
}
