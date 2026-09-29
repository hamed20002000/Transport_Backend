import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DataSource } from 'typeorm';

import { AgentGateway } from 'src/application/services/agent/agent.gateway';
import { AgentToolsService } from 'src/application/services/agent/services/agentTools.service';
import { FunctionCallService } from 'src/application/services/agent/services/functioncall.service';
import { SpeechToTextService } from 'src/application/services/agent/services/Speechtotext.service';
import { AgentRequest } from 'src/application/services/agent/types';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { ConversationSession } from 'src/domain/entities/agent/ConversationSession';
import { JwtPayload } from 'src/domain/entities/auth/jwt-payload.dto';
import { AgentConfirmActionDto, AgentTextMessageDto, AgentVoiceMessageDto } from 'src/dto/agent/agent-chat.dto';
import {
  ATTACHMENT_UPLOAD_DESCRIPTION,
  attachmentUploadOptions,
  removeVoiceFiles,
  resolveAttachments,
  VOICE_UPLOAD_DESCRIPTION,
  voiceUploadOptions,
} from './agent-uploads';

type AuthRequest = { user: JwtPayload };

/**
 * agent برای کاربر عادی (راننده/شرکت/واسطه): پیام متنی یا صوتی می‌گیرد و به
 * همان pipeline تلگرام/واتس‌اپ می‌دهد. پاسخ HTTP فقط `started` است و نتیجه
 * مرحله‌به‌مرحله از socket `/agent` (رویدادهای agent-current-tool و
 * agent-tool-result) می‌رسد. endpointهای مدیریتی در AgentController مانده‌اند.
 */
@Controller('api/agent/chat')
@ApiTags('Agent Chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
export class AgentChatController {
  private readonly logger = new Logger(AgentChatController.name);

  constructor(
    private readonly functionCallService: FunctionCallService,
    private readonly agentToolsService: AgentToolsService,
    private readonly agentGateway: AgentGateway,
    private readonly speechToText: SpeechToTextService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  @Post('sessions')
  @ApiOperation({ summary: 'Start a new chat (reuses the last session if it is still empty)' })
  createSession(@Req() req: AuthRequest) {
    return this.functionCallService.createNewSession(req.user.userId);
  }

  @Get('sessions')
  @ApiOperation({ summary: 'List the current user chats' })
  listSessions(@Req() req: AuthRequest) {
    return this.functionCallService.getUserSessions(req.user.userId);
  }

  @Get('sessions/:sessionId/executions')
  @ApiOperation({ summary: 'Results of a chat, to redraw it when reopened' })
  async sessionExecutions(@Req() req: AuthRequest, @Param('sessionId', ParseUUIDPipe) sessionId: string) {
    await this.assertOwnSession(req.user.userId, sessionId);
    return this.functionCallService.getSessionExecutions(sessionId, req.user.userId);
  }

  @Post('message')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send a text command; results arrive on the /agent socket' })
  async message(@Req() req: AuthRequest, @Body() dto: AgentTextMessageDto) {
    await this.assertOwnSession(req.user.userId, dto.sessionId);
    const files = resolveAttachments(req.user.userId, dto.fileIds);
    return this.run(req.user, dto.prompt, dto.sessionId, files);
  }

  @Post('voice')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['sessionId', 'file'],
      properties: {
        sessionId: { type: 'string', format: 'uuid' },
        file: { type: 'string', format: 'binary', description: VOICE_UPLOAD_DESCRIPTION },
      },
    },
  })
  @ApiOperation({ summary: 'Send a voice command; it is transcribed and run like a text command' })
  @UseInterceptors(FileInterceptor('file', voiceUploadOptions))
  async voice(
    @Req() req: AuthRequest,
    // فرم به‌صورت خام گرفته می‌شود و داخل try اعتبارسنجی می‌شود؛ اگر
    // ValidationPipe قبل از handler رد می‌کرد، فایلِ ذخیره‌شده پاک نمی‌شد.
    @Body() form: Record<string, unknown>,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Audio file is required.');

    let dto: AgentVoiceMessageDto;
    let text: string;
    try {
      dto = await this.validateVoiceForm(form);
      await this.assertOwnSession(req.user.userId, dto.sessionId);
      text = await this.transcribe(file.path);
    } finally {
      await removeVoiceFiles(file.path);
    }

    if (!text) throw new BadRequestException('No speech was recognized in the audio.');

    return { ...(await this.run(req.user, text, dto.sessionId)), text };
  }

  @Post('files')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary', description: ATTACHMENT_UPLOAD_DESCRIPTION } },
    },
  })
  @ApiOperation({ summary: 'Upload an attachment; send the returned fileId in message.fileIds' })
  @UseInterceptors(FileInterceptor('file', attachmentUploadOptions))
  uploadFile(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('File is required.');
    return { fileId: file.filename };
  }

  @Put('confirm-action')
  @ApiOperation({ summary: 'Confirm or reject a pending delete action' })
  confirmAction(@Req() req: AuthRequest, @Body() dto: AgentConfirmActionDto) {
    return this.functionCallService.resumePendingConfirmation(req.user.userId, dto.confirmed, 'web');
  }

  // همان جریان POST agent در setash: اول نوع درخواست، بعد اجرای بدون await
  private async run(user: JwtPayload, prompt: string, sessionId: string, files: string[] = []) {
    const agentRequest: AgentRequest = { user: { userId: user.userId, username: user.username } };

    void this.agentGateway.sendCurrentTool(user.userId, { currentOp: 'در حال بررسی درخواست' });

    const kind = await this.agentToolsService.FunctionCallingOrSqlSelection(prompt);
    if (kind !== 'functionCalling') {
      await this.agentGateway.sendToolResult(user.userId, {
        result: 'error',
        message: 'درخواست مبهم است، لطفاً دقیق‌تر بگویید.',
        prompt,
        continuePrompt: undefined,
        toolName: '',
        lastsegment: true,
        isSpecial: false,
        list: [],
      });
      return { result: 'rejected' as const };
    }

    this.functionCallService
      .RunFunctionCalling(prompt, agentRequest, files, sessionId, 'web')
      .catch((error) => this.logger.error(`RunFunctionCalling failed for ${user.userId}`, error as Error));

    return { result: 'started' as const };
  }

  private async validateVoiceForm(form: Record<string, unknown>): Promise<AgentVoiceMessageDto> {
    const dto = plainToInstance(AgentVoiceMessageDto, form ?? {});
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length) {
      throw new BadRequestException(errors.flatMap((error) => Object.values(error.constraints ?? {})));
    }
    return dto;
  }

  private async assertOwnSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.dataSource
      .getRepository(ConversationSession)
      .findOne({ where: { Id: sessionId }, select: { Id: true, Userid: true } });

    // برای جلسه دیگران هم 404 تا وجودش لو نرود
    if (!session || session.Userid !== userId) {
      throw new NotFoundException('Session not found.');
    }
  }

  private async transcribe(path: string): Promise<string> {
    try {
      return (await this.speechToText.transcribeFile(path)).trim();
    } catch (error) {
      this.logger.error('Voice transcription failed', error as Error);
      throw new BadRequestException('Could not process the audio file.');
    }
  }
}
