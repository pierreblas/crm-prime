import { Module } from "@nestjs/common";
import { ContactsController } from "./contacts.controller";
import { ContactImportService } from "./contact-import.service";

@Module({
  controllers: [ContactsController],
  providers: [ContactImportService],
})
export class ContactsModule {}
