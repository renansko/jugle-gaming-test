import { Module } from "@nestjs/common";
import { WageringService } from "../../../application/wagering/wagering.service";
import { WageringController } from "./wagering.controller";

@Module({
  controllers: [WageringController],
  providers: [WageringService],
  exports: [WageringService],
})
export class WageringModule {}
