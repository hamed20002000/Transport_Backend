import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';

import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { InjectDataSource } from '@nestjs/typeorm';
import { FileInterceptor } from '@nestjs/platform-express';

import type { Request } from 'express';

import { DataSource, Repository } from 'typeorm';

import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { AdminRolesGuard } from 'src/auth/guards/roles.guard';

import {
  ConverToolsToembeddingDocumentEnum,
  CreateVectorBasedEnum,
} from './types';

import { EmbeddingService } from 'src/application/services/agent/services/embedding.service';

import { FunctionCallService } from 'src/application/services/agent/services/functioncall.service';

import { ConversationSession } from 'src/domain/entities/agent/ConversationSession';

import {
  EmbeddingDomainTool,
  EmbeddingToolType,
} from 'src/application/services/agent/types';

import { PendingConfirmationService } from 'src/application/services/agent/services/PendingConfirmationService';

import { JwtPayload } from 'src/domain/entities/auth/jwt-payload.dto';

import { removeVoiceFiles, voiceUploadOptions } from './agent-uploads';
import { SpeechToTextService } from 'src/application/services/agent/services/Speechtotext.service';


// همان چیزی که JwtStrategy.validate برمی‌گرداند
interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}


@Controller('api/agent')
export class AgentController {
  constructor(
    private readonly embedding: EmbeddingService,

    private readonly functionCallService: FunctionCallService,

    private readonly pendingConfirmation: PendingConfirmationService,

    private readonly speechToTextService: SpeechToTextService,

    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}


  @Post('conver-tools-to-embedding-document')
  @ApiTags('converToolsToembeddingDocument')
  @ApiOperation({
    summary: 'conver tools to embedding document',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'return string success or failed.',
  })
  @UseGuards(
    JwtAuthGuard,
    AdminRolesGuard,
  )
  @ApiBearerAuth()
  async convertToolToEmbeddingDocument(): Promise<ConverToolsToembeddingDocumentEnum> {
    try {
      await this.embedding.converToolsToembeddingDocument();

      return ConverToolsToembeddingDocumentEnum.Ok;
    } catch {
      return ConverToolsToembeddingDocumentEnum.Failed;
    }
  }


  @Post('create-vector-based')
  @ApiTags('createVectorBased')
  @ApiOperation({
    summary:
      'convert embedding documents to vector base in database',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'return success or failed.',
  })
  @UseGuards(
    JwtAuthGuard,
    AdminRolesGuard,
  )
  @ApiBearerAuth()
  async createVectorBased(
    @Body() body: EmbeddingToolType[],
  ): Promise<CreateVectorBasedEnum> {
    try {
      await this.embedding.createVectorBased(body);

      return CreateVectorBasedEnum.Ok;
    } catch {
      return CreateVectorBasedEnum.Failed;
    }
  }


  @Post('domaintool')
  @UseGuards(
    JwtAuthGuard,
    AdminRolesGuard,
  )
  @ApiBearerAuth()
  async createVectorBaseForDomain(
    @Body() body: EmbeddingDomainTool[],
  ): Promise<CreateVectorBasedEnum> {
    try {
      await this.embedding.createVectorBasedForDomainTool(
        body,
      );

      return CreateVectorBasedEnum.Ok;
    } catch {
      return CreateVectorBasedEnum.Failed;
    }
  }


  @Post('sessions/new')
  @UseGuards(
    JwtAuthGuard,
    AdminRolesGuard,
  )
  @ApiBearerAuth()
  async createNewSession(
    @Req() req: AuthenticatedRequest,
  ) {
    return this.functionCallService.createNewSession(
      req.user.userId,
    );
  }


  @Get('sessions')
  @UseGuards(
    JwtAuthGuard,
    AdminRolesGuard,
  )
  @ApiBearerAuth()
  async getSessions(
    @Req() req: AuthenticatedRequest,
  ) {
    return this.functionCallService.getUserSessions(
      req.user.userId,
    );
  }


  /**
   * لیست متن‌های خام prompt یک session خاص
   * برای copy / reuse
   */
  @Get('sessions/:sessionId/prompts')
  @UseGuards(
    JwtAuthGuard,
    AdminRolesGuard,
  )
  @ApiBearerAuth()
  async getSessionPrompts(
    @Req() req: AuthenticatedRequest,

    @Param('sessionId')
    sessionId: string,
  ) {
    return this.functionCallService.getSessionPrompts(
      sessionId,
      req.user.userId,
    );
  }


  /**
   * جزئیات کامل نتایج اجراشده‌ی یک session
   * برای پر کردن دوباره پنل نتایج
   */
  @Get('sessions/:sessionId/executions')
  @UseGuards(
    JwtAuthGuard,
    AdminRolesGuard,
  )
  @ApiBearerAuth()
  async getSessionExecutions(
    @Req() req: AuthenticatedRequest,

    @Param('sessionId')
    sessionId: string,
  ) {
    return this.functionCallService.getSessionExecutions(
      sessionId,
      req.user.userId,
    );
  }


  @Put('sessions/changename')
  @UseGuards(
    JwtAuthGuard,
    AdminRolesGuard,
  )
  @ApiBearerAuth()
  async changeSessionTitle(
    @Req() req: AuthenticatedRequest,

    @Body()
    body: {
      sessionId: string;
      name: string;
    },
  ) {
    const repo: Repository<ConversationSession> =
      this.dataSource.getRepository(
        ConversationSession,
      );

    const css = await repo.findOneBy({
      Id: body.sessionId,
    });

    if (!css) {
      throw new NotFoundException(
        'گفتگو پیدا نشد.',
      );
    }

    /*
     * مالکیت session را هم بررسی می‌کنیم.
     */
    if (css.Userid !== req.user.userId) {
      throw new NotFoundException(
        'گفتگو پیدا نشد.',
      );
    }

    css.Title = body.name;

    await repo.save(css);

    return {
      success: true,
    };
  }


  @Put('sessions/confirm-action')
  @UseGuards(
    JwtAuthGuard,
    AdminRolesGuard,
  )
  @ApiBearerAuth()
  async confirmPendingAction(
    @Req() req: AuthenticatedRequest,

    @Body()
    body: {
      confirmed: boolean;
    },
  ) {
    return this.functionCallService
      .resumePendingConfirmation(
        req.user.userId,
        body.confirmed,
        'web',
      );
  }


  @Get('sessions/search')
  @UseGuards(
    JwtAuthGuard,
    AdminRolesGuard,
  )
  @ApiBearerAuth()
  async searchSessions(
    @Req() req: AuthenticatedRequest,

    @Query('q')
    query?: string,
  ) {
    return this.functionCallService.searchUserSessions(
      req.user.userId,
      query ?? '',
    );
  }


  // فقط برای ادمین: کیفیت تبدیل صدا به متن را بدون اجرای agent امتحان می‌کند.
  @Post('speech/transcribe-test')
  @UseGuards(
    JwtAuthGuard,
    AdminRolesGuard,
  )
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor('file', voiceUploadOptions))
  async transcribeTest(
    @UploadedFile()
    file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Audio file is required.');
    }

    const startTime = Date.now();

    try {
      const text =
        await this.speechToTextService
          .transcribeFile(file.path);

      return {
        text,
        elapsedMs: Date.now() - startTime,
      };
    } finally {
      await removeVoiceFiles(file.path);
    }
  }
}