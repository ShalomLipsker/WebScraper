import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import type {
  ScrapeJobStatusView,
  SubmitScrapeJobAcknowledgement,
} from '@org/domain';
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

  @Get(':jobId')
  async getJobStatus(
    @Param('jobId') jobId: string,
  ): Promise<ScrapeJobStatusView> {
    const job = await this.scrapeGatewayService.getJobStatus(jobId);

    if (!job) {
      throw new NotFoundException(`Job ${jobId} was not found`);
    }

    return job;
  }
}