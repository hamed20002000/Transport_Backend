import {
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
import { diskStorage } from 'multer';

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

import { SpeechToTextService } from 'src/application/services/agent/services/Speechtotext.service';


interface AuthenticatedUser {
  userid: string;
  username?: string;
  roles?: string[];
}

interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
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
      req.user.userid,
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
      req.user.userid,
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
      req.user.userid,
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
      req.user.userid,
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
        'Oturum bulunamadı.',
      );
    }

    /*
     * مالکیت session را هم بررسی می‌کنیم.
     */
    if (css.Userid !== req.user.userid) {
      throw new NotFoundException(
        'Oturum bulunamadı.',
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
        req.user.userid,
        body.confirmed,
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
      req.user.userid,
      query ?? '',
    );
  }


  @Post('speech/transcribe-test')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/audio-temp',

        filename: (
          req,
          file,
          cb,
        ) => {
          cb(
            null,
            `${Date.now()}-${file.originalname}`,
          );
        },
      }),
    }),
  )
  async transcribeTest(
    @UploadedFile()
    file: Express.Multer.File,
  ) {
    const startTime = Date.now();

    const text =
      await this.speechToTextService
        .transcribeFile(file.path);

    const elapsedMs =
      Date.now() - startTime;

    return {
      text,
      elapsedMs,
    };
  }
}