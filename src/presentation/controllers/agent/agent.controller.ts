import { Controller, Get, Post, Body, Param, UseGuards, HttpException, HttpStatus, Request, Put, Delete, Req, NotFoundException, Query, UseInterceptors, UploadedFile } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { AdminRolesGuard } from 'src/auth/guards/roles.guard';
import { ConverToolsToembeddingDocumentEnum, CreateVectorBasedEnum } from './types';
import { EmbeddingService } from 'src/application/services/agent/services/embedding.service';
import { FunctionCallService } from 'src/application/services/agent/services/functioncall.service';
import { ConversationSession } from 'src/application/services/agent/entities/ConversationSession';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PromptSubmission } from 'src/application/services/agent/entities/PromptSubmission';
import { ToolExecution } from 'src/application/services/agent/entities/ToolExecution';
import { EmbeddingDomainTool, EmbeddingToolType, PendingAction } from 'src/application/services/agent/types';
import { PendingConfirmationService } from 'src/application/services/agent/services/PendingConfirmationService';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { SpeechToTextService } from 'src/application/services/agent/services/Speechtotext.service';




@Controller('api/agent')
export class AgentController {
  constructor(
    private readonly embedding: EmbeddingService,
    private readonly functionCallService: FunctionCallService,
    private readonly pendingConfirmation: PendingConfirmationService,
    private readonly speechToTextService: SpeechToTextService,
    @InjectDataSource() private readonly dataSource: DataSource
  ) { }



  @Post("conver-tools-to-embedding-document")
  @ApiTags('converToolsToembeddingDocument')
  @ApiOperation({ summary: 'conver tools  to embedding document' })
  @ApiResponse({ status: HttpStatus.OK, description: 'return string success or failed .' })
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @ApiBearerAuth()
  async convertToolToEmbeddingDocument(@Request() req, @Body() body: { text?: string }): Promise<ConverToolsToembeddingDocumentEnum> {

    try {
      await this.embedding.converToolsToembeddingDocument();
      return ConverToolsToembeddingDocumentEnum.Ok
    }
    catch {
      return ConverToolsToembeddingDocumentEnum.Failed;
    }
  }
  @Post("create-vector-based")
  @ApiTags('createVectorBased')
  @ApiOperation({ summary: 'convert embedding documents to vector base in database' })
  @ApiResponse({ status: HttpStatus.OK, description: 'return  success or failed .' })

  async createVectorBased(@Body() body: EmbeddingToolType[]): Promise<CreateVectorBasedEnum> {

    try {
      await this.embedding.createVectorBased(body);
      return CreateVectorBasedEnum.Ok
    }
    catch {
      return CreateVectorBasedEnum.Failed;
    }
  }



  @Post("domaintool")
  async createVectorBaseForDomain(@Body() body: EmbeddingDomainTool[]): Promise<CreateVectorBasedEnum> {

    try {
      await this.embedding.createVectorBasedForDomainTool(body);
      return CreateVectorBasedEnum.Ok
    }
    catch {
      return CreateVectorBasedEnum.Failed;
    }
  }

  @Post('sessions/new')
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @ApiBearerAuth()
  // @UseGuards(AuthGuard) // اگه سایر endpoint هات از یک Guard استفاده می‌کنن، اینجا هم اضافه کن
  async createNewSession(@Request() req: any) {
    const result = await this.functionCallService.createNewSession(req.user.userid);
    return result; // { sessionId: "..." }
  }

  /**
   * لیست همه‌ی session های کاربر -- برای sidebar
   */
  @Get('sessions')
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @ApiBearerAuth()
  async getSessions(@Req() req: any) {
    return this.functionCallService.getUserSessions(req.user.userid);
  }

  /**
   * لیست متن‌های خام prompt یک session خاص -- برای کپی/reuse
   */
  @Get('sessions/:sessionId/prompts')
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @ApiBearerAuth()
  async getSessionPrompts(@Req() req: any, @Param('sessionId') sessionId: string) {
    return this.functionCallService.getSessionPrompts(sessionId, req.user.userid);
  }

  /**
   * جزئیات کامل نتایج اجراشده‌ی یک session -- برای پر کردن دوباره‌ی
   * پنل نتایج وقتی کاربر یک session قدیمی رو باز می‌کنه
   */
  @Get('sessions/:sessionId/executions')
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @ApiBearerAuth()
  async getSessionExecutions(@Req() req: any, @Param('sessionId') sessionId: string) {
    return this.functionCallService.getSessionExecutions(sessionId, req.user.userid);
  }


  @Put('sessions/changename')
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @ApiBearerAuth()
  async changeSessionTitle(
    @Req() req: any,
    @Body() body: { sessionId: string; name: string }
  ) {
    const repo: Repository<ConversationSession> = this.dataSource.getRepository(ConversationSession);

    const css = await repo.findOneBy({ Id: body.sessionId });

    if (!css) {
      throw new NotFoundException('Oturum bulunamadı.');
    }

    css.Title = body.name;
    await repo.save(css); // save() از update() ساده‌تره چون خود entity رو مستقیم می‌گیره

    return { success: true };
  }

  @Put('sessions/confirm-action')
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @ApiBearerAuth()
  async confirmPendingAction(@Req() req: any, @Body() body: { confirmed: boolean }) {
    return this.functionCallService.resumePendingConfirmation(req.user.userid, body.confirmed);
  }
  
  @Get('sessions/search')
  @UseGuards(JwtAuthGuard, AdminRolesGuard)
  @ApiBearerAuth()
  async searchSessions(@Req() req: any, @Query('q') query: string) {
    return this.functionCallService.searchUserSessions(req.user.userid, query ?? "");
  }

  @Post('speech/transcribe-test')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/audio-temp',
        filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
      }),
    })
  )
  async transcribeTest(@UploadedFile() file: Express.Multer.File) {
    const startTime = Date.now();
    const text = await this.speechToTextService.transcribeFile(file.path);
    const elapsedMs = Date.now() - startTime;

    return { text, elapsedMs };
  }

}


