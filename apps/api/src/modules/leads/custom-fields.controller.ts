import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import {
  createCustomFieldSchema,
  updateCustomFieldSchema,
  type CreateCustomFieldInput,
  type UpdateCustomFieldInput,
} from "@crm/shared";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { LeadService } from "./lead.service";

@Controller("custom-fields")
@UseGuards(JwtAuthGuard)
export class CustomFieldsController {
  constructor(private readonly leads: LeadService) {}

  @Get()
  list() {
    return this.leads.listFields();
  }

  // Claves que llegan en los contactos sin campo definido.
  @Get("unmapped")
  unmapped() {
    return this.leads.unmappedFields();
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createCustomFieldSchema))
    body: CreateCustomFieldInput,
  ) {
    return this.leads.createField(body);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(updateCustomFieldSchema))
    body: UpdateCustomFieldInput,
  ) {
    return this.leads.updateField(id, body);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.leads.removeField(id);
  }
}
