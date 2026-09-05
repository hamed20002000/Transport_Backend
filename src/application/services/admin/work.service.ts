import { HttpException, HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { BaseService } from '../base.service';
import { Works } from 'src/domain/entities/Works';
import { WorkRepository } from 'src/infrastructure/repositories/admin/work.repository';
import { ToolRegister } from '../agent/toolRegister';
import { RequestResult } from '../agent/types';
import { UsernameSpecification } from 'src/application/specifications/user/user-specifications';
import { UserService } from '../user/user.service';
import { ContextManager } from '../agent/contextManager';
import message from '../agent/localFiles/messages.json'
import { TenderService } from './tender.service';
import { CreateWorkDto, UpdateWorkDto } from 'src/presentation/dtos/initial-operations/work-dto';
import { recordStatus } from 'src/domain/enums/recordstatus.enum';
import { title } from 'node:process';


@Injectable()
export class WorkService extends BaseService<Works> implements OnModuleInit {
  constructor(

    private readonly workRepository: WorkRepository,
    private readonly toolRtegister: ToolRegister,
    private readonly userService: UserService,
    private readonly history: ContextManager,
    private readonly tenderService: TenderService


  ) {
    super(workRepository);
  }




  onModuleInit() {
    const self = this;
    self.toolRtegister.register({
      functionName: "create_work",
      handler: async function* (param: any): AsyncGenerator<any, RequestResult, any> {

        if (param.title == "" || param.title == null) {
          self.history.addNewHistory({
            status: "fault",
            operation: "create_work",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.work.nameisrequired
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(message.work.nameisrequired, HttpStatus.BAD_REQUEST);
        }

        if (param.tendername == "" || param.tendername == null) {
          self.history.addNewHistory({
            status: "fault",
            operation: "create_work",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.work.tendernameisrequired
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(message.work.tendernameisrequired, HttpStatus.BAD_REQUEST);
        }

        if (param.startdate == "" || param.startdate == null) {
          self.history.addNewHistory({
            status: "fault",
            operation: "create_work",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.work.startdaterequired
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(message.work.startdaterequired, HttpStatus.BAD_REQUEST);
        }

        const user = param.req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await self.userService.getWithSpecification(
          user_specification,
          null,
          { id: true }
        );


        const workTitle = self.toolRtegister.normalizingName(param.title).trim();
        var tender = (await self.tenderService.getTenderByTitle(workTitle))?.[0] ?? undefined;
        if (!tender) {
          const tenders = await self.tenderService.getAllTenders();
          const tenderId = yield { type: "selection", label: "İhalelerden birini seçin.", data: tenders.map((item) => ({ title: item.title, id: item.id })) }
          tender = await self.tenderService.getById(tenderId)
        }
        const work = new Works();
        work.title = workTitle;
        work.startDate = new Date();
        work.endDate = null;
        work.tender = tender;
        work.createAt = new Date();
        work.recordStatus = recordStatus.Active;
        work.user = checkUser;

        const createdWork = await self.add(work);

        self.history.addNewHistory({
          status: "success",
          operation: "create_work",
          parameters: self.history.getParams(param),
          result: {
            "id": createdWork.id.toString(),
            "title": createdWork.title,
            "startDate": createdWork.startDate.toDateString(),
            "tender": createdWork.tender.title
          }
        }, param.req.user.username, param.sessionId)


        return {
          continuePrompt: undefined,
          toolName: "create_work"
        };
      }
    })


    self.toolRtegister.register({
      functionName: "update_work",
      handler: async function* (param: any): AsyncGenerator<any, RequestResult, any> {

        const title = self.toolRtegister.normalizingName(param.title).trim();
        const newTitle = param.newtitle!=null&&param.newtitle!=""?self.toolRtegister.normalizingName(param.newtitle)?.trim():null;
        const tenderName = param.tendername!=null&&param.tendername!=""?self.toolRtegister.normalizingName(param.tendername)?.trim():null;
        const startDate = param.startdate!=null&&param.startdate!=""?self.toolRtegister.normalizingName(param.startdate)?.trim():null;

        let workDto = new Works();
        if (title == "" && title == null) {
          self.history.addNewHistory({
            status: "fault",
            operation: "update_work",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.work.nameisrequired
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(message.work.nameisrequired, HttpStatus.BAD_REQUEST);
        }

        const checkedWork = await self.getWorkByTitle(title);
        if (checkedWork.length > 1) {
          const workId = yield { type: "selection", label: "İşlerden birini seçin.", data: checkedWork.map((item) => ({ title: item.title, id: item.id })) }
          workDto=await self.getWorkById(workId);
        }
        else if(checkedWork.length==1){
          workDto = checkedWork[0];
        }
        else{
             self.history.addNewHistory({
            status: "fault",
            operation: "update_work",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.work.notfound
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(message.work.notfound, HttpStatus.BAD_REQUEST);
        }

        if (tenderName != "" && tenderName != null) {

          var tender = (await self.tenderService.getTendersByTitle(tenderName));
          if (tender && tender.length > 1) {
            const tenders = await self.tenderService.getAllTenders();
            const tenderId = yield { type: "selection", label: "İhalelerden birini seçin.", data: tenders.map((item) => ({ title: item.title, id: item.id })) }
            workDto.tender = await self.tenderService.getById(tenderId)
          }
          else if(tender && tender.length==1){
            workDto.tender = tender[0]
          }
          else{
            self.history.addNewHistory({
            status: "fault",
            operation: "update_work",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.tender.notfound
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(message.tender.notfound, HttpStatus.BAD_REQUEST);
          }

        }

        if (startDate != "" && startDate != null) {
          workDto.startDate = new Date(startDate);
        }
        if(newTitle!=null && newTitle!=""){
          workDto.title = newTitle;
        }
        const updatedWork = await self.update(workDto);

        self.history.addNewHistory({
          status: "success",
          operation: "update_work",
          parameters: self.history.getParams(param),
          result: {
            "id": updatedWork.id.toString(),
            "title": updatedWork.title,
            "startDate": updatedWork.startDate.toDateString(),
            "tender": updatedWork.tender?.title??"",
            "newtitle": newTitle
          }
        }, param.req.user.username, param.sessionId)


        return {
          continuePrompt: undefined,
          toolName: "update_work"
        };
      }
    })


    self.toolRtegister.register({
      functionName: "update_work_record_status",
      handler: async function* (param: any): AsyncGenerator<any, RequestResult, any> {

        const title = self.toolRtegister.normalizingName(param.title).trim();
        const recordStatus =param.recordstatus;

        let workDto = new Works();
        if (title == "" && title == null) {
          self.history.addNewHistory({
            status: "fault",
            operation: "update_work_record_status",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.work.nameisrequired
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(message.work.nameisrequired, HttpStatus.BAD_REQUEST);
        }

        const checkedWork = await self.getWorkByTitle(title);
        if (checkedWork.length > 1) {
          const workId = yield { type: "selection", label: "İşlerden birini seçin.", data: checkedWork.map((item) => ({ title: item.title, id: item.id })) }
          workDto = await self.getWorkById(workId);
          workDto.recordStatus = recordStatus??workDto.recordStatus;
        }
        else if(checkedWork.length==1) {
          workDto=checkedWork[0];
          workDto.recordStatus =recordStatus??workDto.recordStatus;
        }
        else{
            self.history.addNewHistory({
            status: "fault",
            operation: "update_work_record_status",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.work.notfound
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(message.work.notfound, HttpStatus.BAD_REQUEST);
        }

        const updatedWork = await self.update(workDto);

        self.history.addNewHistory({
          status: "success",
          operation: "update_work_record_status",
          parameters: self.history.getParams(param),
          result: {
            "id": updatedWork.id.toString(),
            "title": updatedWork.title,
            "recordstatus":updatedWork.recordStatus.toString()
          }
        }, param.req.user.username, param.sessionId)


        return {
          continuePrompt: undefined,
          toolName: "update_work_record_status"
        };
      }

    })

    self.toolRtegister.register({
      functionName: "delete_work",
      handler: async function* (param: any): AsyncGenerator<any, RequestResult, any> {
        const title=self.toolRtegister.normalizingName(param.title).trim()
        if (title == "" || title == null) {
          self.history.addNewHistory({
            status: "fault",
            operation: "delete_work",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.work.nameisrequired
            }
          }, param.req.user.username, param.sessionId)
          throw new HttpException(message.work.nameisrequired, HttpStatus.BAD_REQUEST);
        }
        let workId;
        const checkedWork = await self.getWorkByTitle(title);
        if (checkedWork.length > 1) {
          workId = yield { type: "selection", label: "İşlerden birini seçin.", data: checkedWork.map((item) => ({ title: item.title, id: item.id })) }
        }
        else {
          workId = checkedWork[0].id;
        }

        self.delete(workId);

        self.history.addNewHistory({
          status: "success",
          operation: "delete_work",
          parameters: self.history.getParams(param),
          result: {
            "id": workId.toString()
          }
        }, param.req.user.username, param.sessionId)
        return {
          continuePrompt: undefined,
          toolName: "delete_work"
        };
      }
    })

  }

  async getAllWorks(): Promise<Works[]> {
    return this.workRepository.getAllWorks();
  }

  async getWorkById(id: number): Promise<Works> {
    return this.workRepository.getWorkById(id);
  }
  async getWorkByTitle(title: string): Promise<Works[]> {
    return this.workRepository.getWorkWithTitle(title);
  }
}



