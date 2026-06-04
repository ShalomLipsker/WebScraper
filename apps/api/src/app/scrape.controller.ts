import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  NotFoundException,
  Param,
  Post,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type {
  ScrapeJobStatusView,
  SubmitScrapeJobAcknowledgement,
} from '@org/domain';
import { SubmitScrapeRequestDto } from './dto/submit-scrape-request.dto';
import {
  type CompletedScrapeJobAccessView,
  ScrapeGatewayService,
} from './scrape-gateway.service';

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

  @Get(':jobId/status')
  async getJobStatus(
    @Param('jobId') jobId: string,
  ): Promise<ScrapeJobStatusView> {
    return this.getExistingJobStatus(jobId);
  }

  @Get(':jobId/content')
  async getScrapedHtml(
    @Param('jobId') jobId: string,
    @Res({ passthrough: true }) response: HeaderWritableResponse,
  ): Promise<StreamableFile> {
    const job = await this.getCompletedJobStatus(jobId);
    const object = await this.scrapeGatewayService.getCompletedJobStream(job);

    response.setHeader('Cache-Control', 'no-store');
    if (object.contentLength !== undefined) {
      response.setHeader('Content-Length', String(object.contentLength));
    }

    return new StreamableFile(object.body, {
      disposition: `inline; filename="${job.jobId}.html"`,
      type: object.contentType ?? 'text/html; charset=utf-8',
    });
  }

  @Get(':jobId/content-url')
  async getScrapedHtmlUrl(
    @Param('jobId') jobId: string,
  ): Promise<CompletedScrapeJobAccessView> {
    const job = await this.getCompletedJobStatus(jobId);

    return this.scrapeGatewayService.getCompletedJobPresignedUrl(job);
  }

  private async getExistingJobStatus(jobId: string): Promise<ScrapeJobStatusView> {
    const job = await this.scrapeGatewayService.getJobStatus(jobId);

    if (!job) {
      throw new NotFoundException(`Job ${jobId} was not found`);
    }

    return job;
  }

  private async getCompletedJobStatus(jobId: string): Promise<ScrapeJobStatusView> {
    const job = await this.getExistingJobStatus(jobId);

    if (job.status !== 'COMPLETED') {
      throw new ConflictException(
        `Job ${jobId} is ${job.status} and its HTML is not available yet`,
      );
    }

    if (!job.resultPath) {
      throw new InternalServerErrorException(
        `Completed job ${jobId} does not have a storage path`,
      );
    }

    return job;
  }
}

interface HeaderWritableResponse {
  setHeader(name: string, value: string): void;
}