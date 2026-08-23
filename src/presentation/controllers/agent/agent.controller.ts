import { Controller, Get, Post, Body, Param, UseGuards, HttpException, HttpStatus, Request, Put, Delete } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { AdminRolesGuard } from 'src/auth/guards/roles.guard';
import { ConverToolsToembeddingDocumentEnum, CreateVectorBasedEnum } from './types';
import { EmbeddingService } from 'src/application/services/agent/services/embedding.service';




@Controller('api/agent')
export class AgentController {
  constructor(
    private readonly embedding:EmbeddingService
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

  async createVectorBased(): Promise<CreateVectorBasedEnum> {

    try {
      await this.embedding.createVectorBased();
      return CreateVectorBasedEnum.Ok
    }
    catch {
      return CreateVectorBasedEnum.Failed;
    }
  }


  @Post("domaintool")
  async createVectorBaseForDomain(): Promise<CreateVectorBasedEnum> {

    try {
      await this.embedding.createVectorBasedForDomainTool();
      return CreateVectorBasedEnum.Ok
    }
    catch {
      return CreateVectorBasedEnum.Failed;
    }
  }

}


