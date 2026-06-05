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
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type {
  ScrapeJobStatusView,
  SubmitScrapeJobAcknowledgement,
} from '@org/domain';
import { PinoLoggerService, getRequestId } from '@org/logger';
import { SubmitScrapeRequestDto } from './dto/submit-scrape-request.dto';
import {
  type CompletedScrapeJobAccessView,
  ScrapeGatewayService,
} from './scrape-gateway.service';

@Controller('scrape')
export class ScrapeController {
  constructor(
    private readonly scrapeGatewayService: ScrapeGatewayService,
    private readonly logger: PinoLoggerService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async submit(
    @Req() request: RequestLike,
    @Body() payload: SubmitScrapeRequestDto,
  ): Promise<SubmitScrapeJobAcknowledgement> {
    const correlationId = getRequestId(request);
    const acknowledgement = await this.scrapeGatewayService.submitJob({
      ...payload,
      correlationId,
    });

    this.logger.log({
      event: 'accepted scrape submission request',
      requestId: correlationId,
      correlationId,
      jobId: acknowledgement.jobId,
      status: acknowledgement.status,
      sourceUrl: acknowledgement.url,
      outcome: 'accepted',
    });

    return acknowledgement;
  }

  @Get(':jobId/status')
  async getJobStatus(
    @Req() request: RequestLike,
    @Param('jobId') jobId: string,
  ): Promise<ScrapeJobStatusView> {
    const requestId = getRequestId(request);
    const job = await this.getExistingJobStatus(jobId, requestId);

    this.logger.log({
      event: 'loaded scrape job status',
      requestId,
      jobId,
      status: job.status,
      outcome: 'loaded',
    });

    return job;
  }

  @Get(':jobId/content')
  async getScrapedHtml(
    @Req() request: RequestLike,
    @Param('jobId') jobId: string,
    @Res({ passthrough: true }) response: HeaderWritableResponse,
  ): Promise<StreamableFile> {
    const requestId = getRequestId(request);
    const job = await this.getCompletedJobStatus(jobId, requestId);
    const object = await this.scrapeGatewayService.getCompletedJobStream(job);

    response.setHeader('Cache-Control', 'no-store');
    if (object.contentLength !== undefined) {
      response.setHeader('Content-Length', String(object.contentLength));
    }

    this.logger.log({
      event: 'streamed completed scrape result',
      requestId,
      jobId,
      contentLength: object.contentLength,
      contentType: object.contentType,
      outcome: 'streamed',
    });

    return new StreamableFile(object.body, {
      disposition: `inline; filename="${job.jobId}.html"`,
      type: object.contentType ?? 'text/html; charset=utf-8',
    });
  }

  @Get(':jobId/content-url')
  async getScrapedHtmlUrl(
    @Req() request: RequestLike,
    @Param('jobId') jobId: string,
  ): Promise<CompletedScrapeJobAccessView> {
    const requestId = getRequestId(request);
    const job = await this.getCompletedJobStatus(jobId, requestId);

    const result = await this.scrapeGatewayService.getCompletedJobPresignedUrl(job);

    this.logger.log({
      event: 'created completed scrape presigned url',
      requestId,
      jobId,
      expiresAt: result.expiresAt,
      outcome: 'created',
    });

    return result;
  }

  private async getExistingJobStatus(
    jobId: string,
    correlationId?: string,
  ): Promise<ScrapeJobStatusView> {
    const job = await this.scrapeGatewayService.getJobStatus(jobId, correlationId);

    if (!job) {
      throw new NotFoundException(`Job ${jobId} was not found`);
    }

    return job;
  }

  private async getCompletedJobStatus(
    jobId: string,
    correlationId?: string,
  ): Promise<ScrapeJobStatusView> {
    const job = await this.getExistingJobStatus(jobId, correlationId);

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

interface RequestLike {
  id?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}