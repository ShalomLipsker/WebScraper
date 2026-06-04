import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { SubmitScrapeJobAcknowledgement } from '@org/domain';
import { SubmitScrapeRequestDto } from './dto/submit-scrape-request.dto';
import { ScrapeGatewayService } from './scrape-gateway.service';

@Controller('scrape')
export class ScrapeController {
  constructor(private readonly scrapeGatewayService: ScrapeGatewayService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  submit(
    @Body() payload: SubmitScrapeRequestDto,
  ): Promise<SubmitScrapeJobAcknowledgement> {
    return this.scrapeGatewayService.submitJob(payload);
  }
}